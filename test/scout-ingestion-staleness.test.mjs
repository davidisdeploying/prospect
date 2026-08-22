import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import { upsertSubscription, notifyScoutIngestionStale } from '../server/push.js';
import {
  scoutIngestionStaleness,
  staleThresholdDays,
  DEFAULT_STALE_THRESHOLD_DAYS,
} from '../server/scoutGmail.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function withVapidConfig(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-stale-push-'));
  const vapidPath = path.join(tmpDir, 'vapid.json');
  fs.writeFileSync(vapidPath, JSON.stringify({
    subject: 'mailto:test@example.com',
    publicKey: 'pubKeyTest123456789012345678901234567890',
    privateKey: 'privKeyTest1234567890',
  }), { mode: 0o600 });
  const previous = process.env.PROSPECT_VAPID_PATH;
  process.env.PROSPECT_VAPID_PATH = vapidPath;
  return Promise.resolve()
    .then(run)
    .finally(() => {
      if (previous) process.env.PROSPECT_VAPID_PATH = previous;
      else delete process.env.PROSPECT_VAPID_PATH;
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });
}

function subscribe(db, { quiet = false } = {}) {
  upsertSubscription(db, {
    endpoint: 'https://push.example.com/sub/stale',
    p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
    auth: 'authSecret123456',
    userAgent: 'test',
  });
  db.prepare('UPDATE push_subscriptions SET quiet_hours_enabled = ?').run(quiet ? 1 : 0);
  return db.prepare('SELECT * FROM push_subscriptions LIMIT 1').get();
}

function seedReceipt(db, { id, receivedAt, status = 'imported' }) {
  db.prepare(`
    INSERT INTO scout_gmail_messages (gmail_message_id, received_at, status, job_count)
    VALUES (?, ?, ?, 1)
  `).run(id, receivedAt, status);
}

const NOW = new Date('2026-08-07T16:00:00.000Z');

test('a fresh install with no accepted mail is not stale', () => {
  const db = freshDb();
  const result = scoutIngestionStaleness(db, { now: NOW });
  assert.equal(result.stale, false);
  assert.equal(result.lastIngestAt, null);
  assert.equal(result.reason, 'no ingestion baseline');
  db.close();
});

test('recent accepted mail is not stale', () => {
  const db = freshDb();
  seedReceipt(db, { id: 'm1', receivedAt: '2026-08-07T04:00:00.000Z' });
  const result = scoutIngestionStaleness(db, { now: NOW });
  assert.equal(result.stale, false);
  assert.ok(result.daysStale < 1);
  db.close();
});

test('the 2026-08-07 outage shape is detected: eight days without accepted mail', () => {
  const db = freshDb();
  seedReceipt(db, { id: 'm1', receivedAt: '2026-07-30T16:00:00.000Z' });
  const result = scoutIngestionStaleness(db, { now: NOW });
  assert.equal(result.stale, true);
  assert.equal(Math.round(result.daysStale), 8);
  assert.equal(result.thresholdDays, DEFAULT_STALE_THRESHOLD_DAYS);
  db.close();
});

test('staleness is measured from accepted mail, not from discoveries', () => {
  // Repeat alerts legitimately create zero new discoveries while ingestion is perfectly healthy.
  // Measuring from discoveries would fire a false alarm on a week of duplicate postings.
  const db = freshDb();
  seedReceipt(db, { id: 'm1', receivedAt: '2026-08-07T04:00:00.000Z' });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM scout_discoveries').get().c, 0);
  assert.equal(scoutIngestionStaleness(db, { now: NOW }).stale, false);
  db.close();
});

test('rejected mail does not count as ingestion', () => {
  const db = freshDb();
  seedReceipt(db, { id: 'old', receivedAt: '2026-07-30T16:00:00.000Z', status: 'imported' });
  seedReceipt(db, { id: 'spam', receivedAt: '2026-08-07T04:00:00.000Z', status: 'ignored' });
  seedReceipt(db, { id: 'broken', receivedAt: '2026-08-07T05:00:00.000Z', status: 'error' });
  const result = scoutIngestionStaleness(db, { now: NOW });
  assert.equal(result.stale, true, 'ignored/error receipts must not mask a real outage');
  assert.equal(result.lastIngestAt, '2026-07-30T16:00:00.000Z');
  db.close();
});

test('the threshold boundary is inclusive and env-overridable', () => {
  const db = freshDb();
  seedReceipt(db, { id: 'm1', receivedAt: '2026-08-04T16:00:00.000Z' });
  assert.equal(scoutIngestionStaleness(db, { now: NOW, thresholdDays: 3 }).stale, true);
  assert.equal(scoutIngestionStaleness(db, { now: NOW, thresholdDays: 4 }).stale, false);

  assert.equal(staleThresholdDays({}), DEFAULT_STALE_THRESHOLD_DAYS);
  assert.equal(staleThresholdDays({ PROSPECT_SCOUT_STALE_DAYS: '7' }), 7);
  assert.equal(staleThresholdDays({ PROSPECT_SCOUT_STALE_DAYS: 'nonsense' }), DEFAULT_STALE_THRESHOLD_DAYS);
  assert.equal(staleThresholdDays({ PROSPECT_SCOUT_STALE_DAYS: '0' }), DEFAULT_STALE_THRESHOLD_DAYS);
  db.close();
});

test('an unparseable received_at fails quiet rather than alerting', () => {
  const db = freshDb();
  seedReceipt(db, { id: 'm1', receivedAt: 'not-a-date' });
  const result = scoutIngestionStaleness(db, { now: NOW });
  assert.equal(result.stale, false);
  assert.equal(result.reason, 'unparseable received_at');
  db.close();
});

test('the stale alert sends once and is idempotent for the same outage', async () => {
  await withVapidConfig(async () => {
    const db = freshDb();
    subscribe(db);
    const sent = [];
    const transport = async ({ options }) => {
      sent.push(options);
      return { statusCode: 201 };
    };
    const args = {
      daysStale: 8,
      lastIngestAt: '2026-07-30T16:00:00.000Z',
      thresholdDays: 3,
      transport,
      now: NOW,
    };

    const first = await notifyScoutIngestionStale(db, args);
    const second = await notifyScoutIngestionStale(db, args);

    assert.equal(first.sent, 1);
    assert.equal(second.sent, 0, 'the same outage must not re-alert on the next run');
    assert.equal(sent.length, 1);
    assert.equal(first.event_key, 'scout-ingestion-stale:2026-07-30:w0');
    db.close();
  });
});

test('a prolonged outage re-alerts weekly, and a later outage gets a fresh key', async () => {
  await withVapidConfig(async () => {
    const db = freshDb();
    subscribe(db);
    const transport = async () => ({ statusCode: 201 });
    const base = { lastIngestAt: '2026-07-30T16:00:00.000Z', thresholdDays: 3, transport, now: NOW };

    const day3 = await notifyScoutIngestionStale(db, { ...base, daysStale: 3 });
    const day9 = await notifyScoutIngestionStale(db, { ...base, daysStale: 9 });
    const day10 = await notifyScoutIngestionStale(db, { ...base, daysStale: 10 });

    assert.equal(day3.event_key, 'scout-ingestion-stale:2026-07-30:w0');
    assert.equal(day9.event_key, 'scout-ingestion-stale:2026-07-30:w0', 'still inside week 0');
    assert.equal(day9.sent, 0);
    assert.equal(day10.event_key, 'scout-ingestion-stale:2026-07-30:w1', 'week 1 reminder');
    assert.equal(day10.sent, 1);

    // A distinct later outage keys off its own last-ingest date.
    const later = await notifyScoutIngestionStale(db, {
      ...base,
      lastIngestAt: '2026-09-01T16:00:00.000Z',
      daysStale: 3,
    });
    assert.equal(later.event_key, 'scout-ingestion-stale:2026-09-01:w0');
    assert.equal(later.sent, 1);
    db.close();
  });
});

test('quiet hours defer the stale alert instead of dropping it', async () => {
  await withVapidConfig(async () => {
    const db = freshDb();
    subscribe(db, { quiet: true });
    let calls = 0;
    const transport = async () => { calls += 1; return { statusCode: 201 }; };
    // 04:00 UTC is 23:00 Chicago, inside the default 22:00-07:00 quiet window.
    const result = await notifyScoutIngestionStale(db, {
      daysStale: 8,
      lastIngestAt: '2026-07-30T16:00:00.000Z',
      thresholdDays: 3,
      transport,
      now: new Date('2026-08-08T04:00:00.000Z'),
    });
    assert.equal(result.sent, 0);
    assert.equal(result.deferred, 1);
    assert.equal(calls, 0);
    const pending = db.prepare('SELECT COUNT(*) c FROM push_pending_notifications').get().c;
    assert.equal(pending, 1, 'the alert must survive quiet hours as a pending delivery');
    db.close();
  });
});

test('no active subscription is reported, not silently swallowed', async () => {
  await withVapidConfig(async () => {
    const db = freshDb();
    const result = await notifyScoutIngestionStale(db, {
      daysStale: 8,
      lastIngestAt: '2026-07-30T16:00:00.000Z',
      thresholdDays: 3,
      transport: async () => ({ statusCode: 201 }),
      now: NOW,
    });
    assert.equal(result.sent, 0);
    assert.equal(result.reason, 'no active subscriptions');
    db.close();
  });
});
