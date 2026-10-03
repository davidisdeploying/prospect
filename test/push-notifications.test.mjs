import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
  loadVapidConfig, ensureVapidKeys, validateSubscriptionInput,
  upsertSubscription, deactivateSubscription, getSubscriptionStatus,
  updateSubscriptionPreferences, isSubscriptionQuiet, nextAllowedNotificationMs,
  queuePendingNotification, flushPendingNotifications,
  buildScoutPushPayload, sendPushNotification, notifyScoutNewLeads,
} from '../server/push.js';
import { getScout, renderScoutHtml } from '../server/scout.js';
import { runGmailScout } from '../server/scoutGmail.js';
import { migrationHeadVersion, schemaHeadVersion } from './helpers/schemaVersion.mjs';

function createTempDb() {
  const tmpFile = path.join(os.tmpdir(), `prospect-test-push-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(tmpFile);
  db.pragma('foreign_keys = ON');
  return { db, tmpFile };
}

function initDbV15(db) {
  db.exec(`
    CREATE TABLE scout_profile_versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      profile_json TEXT NOT NULL,
      profile_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO scout_profile_versions (label, profile_json, profile_hash)
    VALUES ('Default', '{}', 'h1');

    CREATE TABLE scout_discoveries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      source_key TEXT NOT NULL UNIQUE,
      external_job_id TEXT,
      source_url TEXT NOT NULL,
      apply_url TEXT,
      company TEXT,
      role TEXT NOT NULL,
      location TEXT,
      description TEXT,
      posted_at TEXT,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','shortlisted','dismissed','captured')),
      profile_version_id INTEGER REFERENCES scout_profile_versions(id),
      fit_score REAL NOT NULL,
      fit_label TEXT NOT NULL,
      assessment_json TEXT NOT NULL
    );
    CREATE TABLE scout_sightings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discovery_id INTEGER NOT NULL REFERENCES scout_discoveries(id),
      seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_id TEXT,
      raw_payload TEXT NOT NULL,
      snapshot_hash TEXT NOT NULL UNIQUE
    );
    CREATE TABLE scout_gmail_messages (
      gmail_message_id TEXT PRIMARY KEY,
      gmail_thread_id TEXT,
      received_at TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL CHECK (status IN ('imported','ignored','parse_empty','error')),
      job_count INTEGER NOT NULL DEFAULT 0,
      detail TEXT
    );
    PRAGMA user_version = 15;
  `);
}

function applyMigration016(db) {
  const migSql = fs.readFileSync(path.join(process.cwd(), 'migrations', '016_push_notifications.sql'), 'utf8');
  db.exec(migSql);
}

function applyMigration017(db) {
  const migSql = fs.readFileSync(path.join(process.cwd(), 'migrations', '017_notification_preferences.sql'), 'utf8');
  db.exec(migSql);
}

function applyPushMigrations(db) {
  applyMigration016(db);
  applyMigration017(db);
}

test('migration 015 -> 016 -> 017 applies cleanly with preferences and pending delivery', () => {
  const { db, tmpFile } = createTempDb();
  try {
    initDbV15(db);
    assert.equal(db.pragma('user_version', { simple: true }), 15);
    applyMigration016(db);
    assert.equal(db.pragma('user_version', { simple: true }), 16);
    applyMigration017(db);
    assert.equal(db.pragma('user_version', { simple: true }), 17);

    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    assert.ok(tables.includes('push_subscriptions'));
    assert.ok(tables.includes('push_delivery_log'));
    assert.ok(tables.includes('push_pending_notifications'));
    const columns = db.prepare('PRAGMA table_info(push_subscriptions)').all().map((row) => row.name);
    assert.ok(columns.includes('scout_enabled'));
    assert.ok(columns.includes('today_enabled'));
    assert.ok(columns.includes('quiet_hours_enabled'));

    const pragmaFk = db.prepare("PRAGMA foreign_key_check").all();
    assert.equal(pragmaFk.length, 0);
  } finally {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('fresh schema matches migration 017 tables and constraints', () => {
  const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
  // The head version tracks the newest migration, not 017 -- this test owns 017's tables below.
  assert.equal(schemaHeadVersion(), migrationHeadVersion());
  assert.ok(schemaSql.includes('CREATE TABLE push_subscriptions'));
  assert.ok(schemaSql.includes('CREATE TABLE push_delivery_log'));
  assert.ok(schemaSql.includes('CREATE TABLE push_pending_notifications'));
});

test('missing VAPID key file degrades safely without crash', () => {
  const fakePath = path.join(os.tmpdir(), `nonexistent-vapid-${Date.now()}.json`);
  const prevEnv = process.env.PROSPECT_VAPID_PATH;
  process.env.PROSPECT_VAPID_PATH = fakePath;
  try {
    const config = loadVapidConfig();
    assert.equal(config.enabled, false);
    assert.match(config.reason, /absent/i);
  } finally {
    if (prevEnv) process.env.PROSPECT_VAPID_PATH = prevEnv;
    else delete process.env.PROSPECT_VAPID_PATH;
  }
});

test('ensureVapidKeys generates valid keypair with 0600 file mode and 0700 dir mode', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-gen-test-'));
  const vapidPath = path.join(tmpDir, 'push', 'vapid.json');
  const prevEnv = process.env.PROSPECT_VAPID_PATH;
  process.env.PROSPECT_VAPID_PATH = vapidPath;
  try {
    const config = ensureVapidKeys();
    assert.equal(config.enabled, true);
    assert.equal(config.subject, 'mailto:owner@example.com');
    assert.ok(config.publicKey && config.publicKey.length > 30);
    assert.ok(config.privateKey && config.privateKey.length > 20);

    const fileStat = fs.statSync(vapidPath);
    assert.equal(fileStat.mode & 0o777, 0o600);
    const dirStat = fs.statSync(path.dirname(vapidPath));
    assert.equal(dirStat.mode & 0o777, 0o700);
  } finally {
    if (prevEnv) process.env.PROSPECT_VAPID_PATH = prevEnv;
    else delete process.env.PROSPECT_VAPID_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('subscription input validation enforces HTTPS and base64 bounds', () => {
  assert.equal(validateSubscriptionInput({ endpoint: 'http://evil.com', p256dh: 'abc', auth: 'xyz' }).valid, false);
  assert.equal(validateSubscriptionInput({ endpoint: 'https://push.example.com/sub/123', p256dh: 'invalid key!', auth: 'xyz' }).valid, false);
  assert.equal(validateSubscriptionInput({
    endpoint: 'https://push.example.com/sub/123',
    p256dh: 'BNcRdreHzB9M1-54-32101234567890abcdef',
    auth: 'authSecret123456',
  }).valid, true);
});

test('subscription upsert and deactivation logic', () => {
  const { db, tmpFile } = createTempDb();
  try {
    initDbV15(db);
    applyPushMigrations(db);

    const subData = {
      endpoint: 'https://push.example.com/sub/test1',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
      userAgent: 'Mozilla/5.0 TestBrowser',
    };

    const upRes = upsertSubscription(db, subData);
    assert.equal(upRes.ok, true);

    let status = getSubscriptionStatus(db, subData.endpoint);
    assert.equal(status.subscribed, true);

    deactivateSubscription(db, subData.endpoint);
    status = getSubscriptionStatus(db, subData.endpoint);
    assert.equal(status.subscribed, false);
  } finally {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('per-device notification preferences validate and persist without replacing push keys', () => {
  const { db, tmpFile } = createTempDb();
  try {
    initDbV15(db);
    applyPushMigrations(db);
    const subData = {
      endpoint: 'https://push.example.com/sub/preferences',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
    };
    upsertSubscription(db, subData);

    const updated = updateSubscriptionPreferences(db, subData.endpoint, {
      scout_enabled: false,
      today_enabled: true,
      quiet_hours_enabled: true,
      quiet_start: '21:30',
      quiet_end: '06:45',
    });
    assert.equal(updated.ok, true);
    assert.deepEqual(updated.preferences, {
      scout_enabled: false,
      today_enabled: true,
      quiet_hours_enabled: true,
      quiet_start: '21:30',
      quiet_end: '06:45',
      timezone: 'America/Chicago',
    });
    const row = db.prepare('SELECT p256dh, auth FROM push_subscriptions WHERE endpoint = ?').get(subData.endpoint);
    assert.equal(row.p256dh, subData.p256dh);
    assert.equal(row.auth, subData.auth);

    const invalid = updateSubscriptionPreferences(db, subData.endpoint, {
      scout_enabled: true,
      today_enabled: true,
      quiet_hours_enabled: true,
      quiet_start: '25:00',
      quiet_end: '07:00',
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.status, 400);
  } finally {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('Chicago quiet hours span midnight and compute the next eligible minute', () => {
  const subscription = {
    quiet_hours_enabled: 1,
    quiet_start: '22:00',
    quiet_end: '07:00',
  };
  const elevenPmChicago = new Date('2026-07-30T04:00:00.000Z');
  const sevenAmChicago = new Date('2026-07-30T12:00:00.000Z');
  assert.equal(isSubscriptionQuiet(subscription, elevenPmChicago), true);
  assert.equal(isSubscriptionQuiet(subscription, sevenAmChicago), false);
  assert.equal(
    nextAllowedNotificationMs(subscription, elevenPmChicago),
    sevenAmChicago.getTime(),
  );
  assert.equal(isSubscriptionQuiet({ ...subscription, quiet_hours_enabled: 0 }, elevenPmChicago), false);
});

test('quiet Scout delivery is queued once and retains the latest payload', () => {
  const { db, tmpFile } = createTempDb();
  try {
    initDbV15(db);
    applyPushMigrations(db);
    upsertSubscription(db, {
      endpoint: 'https://push.example.com/sub/queued',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
    });
    const sub = db.prepare('SELECT * FROM push_subscriptions WHERE active = 1').get();
    const now = new Date('2026-07-30T04:00:00.000Z');
    queuePendingNotification(db, sub, {
      category: 'scout',
      eventKey: 'scout-daily-leads:2026-07-29',
      payload: { version: 1 },
      now,
    });
    queuePendingNotification(db, sub, {
      category: 'scout',
      eventKey: 'scout-daily-leads:2026-07-29',
      payload: { version: 2 },
      now,
    });
    const rows = db.prepare('SELECT payload, not_before_ms FROM push_pending_notifications').all();
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].payload), { version: 2 });
    assert.equal(rows[0].not_before_ms, new Date('2026-07-30T12:00:00.000Z').getTime());
  } finally {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('DWP payload shape and buildScoutPushPayload formatting', () => {
  const payload = buildScoutPushPayload({
    newJobsCount: 2,
    totalNewCount: 5,
    bestJob: { role: 'Senior Systems Engineer', company: 'Charlie Corp' },
  });

  assert.equal(payload.web_push, 8030);
  assert.equal(payload.notification.title, 'Scout found 2 new leads');
  assert.equal(payload.notification.body, 'Senior Systems Engineer at Charlie Corp');
  assert.equal(payload.notification.navigate, '/scout?status=new');
  assert.equal(payload.notification.tag, 'scout-daily-leads');
  assert.equal(payload.notification.app_badge, 5);
});

test('404/410/403 deactivates immediately; transient failures count up and disable at five', async () => {
  const { db, tmpFile } = createTempDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-err-test-'));
  const vapidPath = path.join(tmpDir, 'vapid.json');
  fs.writeFileSync(vapidPath, JSON.stringify({
    subject: 'mailto:test@example.com',
    publicKey: 'pubKeyTest123456789012345678901234567890',
    privateKey: 'privKeyTest1234567890',
  }), { mode: 0o600 });
  process.env.PROSPECT_VAPID_PATH = vapidPath;

  try {
    initDbV15(db);
    applyPushMigrations(db);

    const subData = {
      endpoint: 'https://push.example.com/sub/err1',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
    };
    upsertSubscription(db, subData);
    const subRow = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint = ?').get(subData.endpoint);

    // Mock transport returning 410 Gone
    const mockTransport410 = async () => {
      const err = new Error('Expired subscription');
      err.statusCode = 410;
      throw err;
    };

    const res410 = await sendPushNotification(db, subRow, { test: 1 }, { transport: mockTransport410 });
    assert.equal(res410.ok, false);
    assert.equal(res410.statusCode, 410);

    const deactivatedRow = db.prepare('SELECT active FROM push_subscriptions WHERE endpoint = ?').get(subData.endpoint);
    assert.equal(deactivatedRow.active, 0);

    const logCount = db.prepare('SELECT count(*) FROM push_delivery_log').pluck().get();
    assert.equal(logCount, 1);

    const transientData = {
      endpoint: 'https://push.example.com/sub/transient',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
    };
    upsertSubscription(db, transientData);
    const transientSub = db.prepare(
      'SELECT * FROM push_subscriptions WHERE endpoint = ?',
    ).get(transientData.endpoint);
    const mockTransport500 = async () => {
      const err = new Error('Temporary push service failure');
      err.statusCode = 500;
      throw err;
    };

    for (let failure = 1; failure <= 5; failure += 1) {
      const result = await sendPushNotification(
        db,
        transientSub,
        { test: 1 },
        { transport: mockTransport500 },
      );
      assert.equal(result.ok, false);
      assert.equal(result.statusCode, 500);
      const row = db.prepare(
        'SELECT active, failure_count FROM push_subscriptions WHERE endpoint = ?',
      ).get(transientData.endpoint);
      assert.equal(row.failure_count, failure);
      assert.equal(row.active, failure < 5 ? 1 : 0);
    }

    const failedLogs = db.prepare(
      "SELECT count(*) FROM push_delivery_log WHERE status = 'failed'",
    ).pluck().get();
    assert.equal(failedLogs, 6);
  } finally {
    delete process.env.PROSPECT_VAPID_PATH;
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Scout deep-link status query filtering in getScout', () => {
  const { db, tmpFile } = createTempDb();
  try {
    initDbV15(db);
    applyPushMigrations(db);

    db.prepare(`
      INSERT INTO scout_discoveries (source, source_key, role, company, source_url, fit_score, fit_label, assessment_json, status)
      VALUES ('test', 'k1', 'Role A', 'Comp A', 'https://example.com/1', 9.0, 'Strong', '{\"score\":9,\"label\":\"Strong\",\"reasons\":[\"Match\"],\"cautions\":[]}', 'new'),
             ('test', 'k2', 'Role B', 'Comp B', 'https://example.com/2', 8.0, 'Good', '{\"score\":8,\"label\":\"Good\",\"reasons\":[\"Match\"],\"cautions\":[]}', 'shortlisted'),
             ('test', 'k3', 'Role C', 'Comp C', 'https://example.com/3', 5.0, 'Pass', '{\"score\":5,\"label\":\"Pass\",\"reasons\":[],\"cautions\":[]}', 'dismissed')
    `).run();

    const newOnly = getScout(db, { status: 'new' });
    assert.equal(newOnly.discoveries.length, 1);
    assert.equal(newOnly.discoveries[0].role, 'Role A');

    const shortlistedOnly = getScout(db, { status: 'shortlisted' });
    assert.equal(shortlistedOnly.discoveries.length, 1);
    assert.equal(shortlistedOnly.discoveries[0].role, 'Role B');

    const review = getScout(db, { status: 'review' });
    assert.equal(review.discoveries.length, 2);

    const html = renderScoutHtml(newOnly, { status: 'new' });
    assert.ok(html.includes('scout-push.js'));
    assert.ok(html.includes('scout-push-card'));
  } finally {
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  }
});

test('notifyScoutNewLeads triggers notification only when newJobsCount > 0', async () => {
  const { db, tmpFile } = createTempDb();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vapid-notify-test-'));
  const vapidPath = path.join(tmpDir, 'vapid.json');
  fs.writeFileSync(vapidPath, JSON.stringify({
    subject: 'mailto:test@example.com',
    publicKey: 'pubKeyTest123456789012345678901234567890',
    privateKey: 'privKeyTest1234567890',
  }), { mode: 0o600 });
  process.env.PROSPECT_VAPID_PATH = vapidPath;

  try {
    initDbV15(db);
    applyPushMigrations(db);

    upsertSubscription(db, {
      endpoint: 'https://push.example.com/sub/notify1',
      p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
      auth: 'authSecret123456',
    });

    let mockSent = 0;
    const mockTransport = async () => {
      mockSent += 1;
      return { statusCode: 201 };
    };

    const zeroRes = await notifyScoutNewLeads(db, { newJobsCount: 0, transport: mockTransport });
    assert.equal(zeroRes.sent, 0);
    assert.equal(mockSent, 0);

    const activeRes = await notifyScoutNewLeads(db, {
      newJobsCount: 1,
      totalNewCount: 1,
      bestJob: { role: 'Dev' },
      transport: mockTransport,
      now: new Date('2026-07-30T15:00:00.000Z'),
    });
    assert.equal(activeRes.sent, 1);
    assert.equal(mockSent, 1);

    const subscription = db.prepare('SELECT * FROM push_subscriptions WHERE active = 1').get();
    db.prepare('UPDATE push_subscriptions SET scout_enabled = 0 WHERE id = ?').run(subscription.id);
    const disabledRes = await notifyScoutNewLeads(db, {
      newJobsCount: 1,
      totalNewCount: 2,
      transport: mockTransport,
      now: new Date('2026-07-31T15:00:00.000Z'),
    });
    assert.equal(disabledRes.sent, 0);
    assert.equal(mockSent, 1);

    db.prepare('UPDATE push_subscriptions SET scout_enabled = 1 WHERE id = ?').run(subscription.id);
    const quietRes = await notifyScoutNewLeads(db, {
      newJobsCount: 1,
      totalNewCount: 3,
      transport: mockTransport,
      now: new Date('2026-08-01T04:00:00.000Z'),
    });
    assert.equal(quietRes.sent, 0);
    assert.equal(quietRes.deferred, 1);
    assert.equal(mockSent, 1);
    assert.equal(db.prepare('SELECT count(*) FROM push_pending_notifications WHERE delivered_at IS NULL').pluck().get(), 1);
  } finally {
    delete process.env.PROSPECT_VAPID_PATH;
    db.close();
    if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('SW push and click handlers present and preserve cross-origin safety', () => {
  const swSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'src', 'sw.js'), 'utf8');
  assert.ok(swSrc.includes('addEventListener("push"') || swSrc.includes("addEventListener('push'"));
  assert.ok(swSrc.includes('addEventListener("notificationclick"') || swSrc.includes("addEventListener('notificationclick'"));
  assert.ok(swSrc.includes('showNotification'));
  assert.ok(swSrc.includes('setAppBadge'));
  assert.ok(swSrc.includes('clients.matchAll'));
  assert.ok(swSrc.includes('self.location.origin'));
});

test('scout-push.js client helper is present in public static directory', () => {
  const helperSrc = fs.readFileSync(path.join(process.cwd(), 'app', 'public', 'scout-push.js'), 'utf8');
  assert.ok(helperSrc.includes('urlBase64ToUint8Array'));
  assert.ok(helperSrc.includes('/api/push/vapid-public-key'));
  assert.ok(helperSrc.includes('/api/push/subscribe'));
  assert.ok(helperSrc.includes('/api/push/preferences'));
  assert.ok(helperSrc.includes('push-pref-quiet'));
  assert.ok(helperSrc.includes('Notification.requestPermission'));
  assert.ok(helperSrc.includes('(display-mode: standalone)'));
});
