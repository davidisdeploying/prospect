import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import { upsertSubscription } from '../server/push.js';
import {
  buildTodayNotificationPlan,
  dispatchTodayNotifications,
  wasTodayNotificationDelivered,
} from '../server/todayNotifications.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db, {
  company = 'Acme',
  role = 'Support Engineer',
  stage = 'Staked',
  action = null,
  actionDate = null,
  activelyReviewing = null,
  topApplicantMatch = null,
  gutPrediction = null,
  applicationMinutes = null,
} = {}) {
  const listing = db.prepare(`
    INSERT INTO listings (
      source, company, role, actively_reviewing, top_applicant_match
    ) VALUES ('test', ?, ?, ?, ?)
  `).run(company, role, activelyReviewing, topApplicantMatch);
  return db.prepare(`
    INSERT INTO claims (
      listing_id, stage, next_action, next_action_date,
      gut_prediction, application_minutes
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(listing.lastInsertRowid, stage, action, actionDate, gutPrediction, applicationMinutes).lastInsertRowid;
}

function seedEvent(db, { claimId, dueAt, kind = 'assessment_requested', note = null }) {
  return db.prepare(`
    INSERT INTO claim_events (claim_id, kind, due_at, payload)
    VALUES (?, ?, ?, ?)
  `).run(claimId, kind, dueAt, note ? JSON.stringify({ note }) : null).lastInsertRowid;
}

function withVapidConfig(run) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-today-push-'));
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

// Dispatch defaults `now` to the real clock, and subscribe() below inherits migration 017's
// quiet_hours_enabled=1 / 22:00-07:00 default. Any test that asserts a notification was SENT must
// therefore pin `now` inside the awake window, or it silently fails whenever the suite happens to
// run overnight (observed 2026-08-09 01:15 CDT: two tests reported sent:0 for this reason alone).
const AWAKE_NOW = new Date('2026-07-30T15:00:00.000Z'); // 10:00 America/Chicago

function subscribe(db) {
  upsertSubscription(db, {
    endpoint: 'https://push.example.com/sub/today',
    p256dh: 'BNcRdreHzB9M15432101234567890abcdef',
    auth: 'authSecret123456',
    userAgent: 'iPhone PWA',
  });
  return db.prepare('SELECT * FROM push_subscriptions WHERE active = 1').get();
}

test('empty queue produces no Today notification plan', () => {
  const db = freshDb();
  try {
    assert.equal(buildTodayNotificationPlan(db, { today: '2026-07-30' }), null);
  } finally {
    db.close();
  }
});

test('hard gate within two days outranks even a strong Nugget and deep-links to its claim', () => {
  const db = freshDb();
  try {
    const actionClaim = seedClaim(db, {
      company: 'Strong Co',
      action: 'Reply to recruiter',
      actionDate: '2026-07-30',
      stage: 'Working the Vein',
      activelyReviewing: 1,
      topApplicantMatch: 1,
      gutPrediction: 0.9,
    });
    const gateClaim = seedClaim(db, { company: 'Gate Co', role: 'Cloud Technician' });
    seedEvent(db, { claimId: gateClaim, dueAt: '2026-08-01' });

    const plan = buildTodayNotificationPlan(db, { today: '2026-07-30' });
    assert.equal(plan.kind, 'hard_gate');
    assert.equal(plan.event_key, 'today-hard-gate:2026-07-30');
    assert.equal(plan.urgency, 'high');
    assert.equal(plan.primary_claim_id, gateClaim);
    assert.equal(plan.payload.notification.title, 'Hard gate due in 2 days');
    assert.equal(plan.payload.notification.navigate, `/?claim=${gateClaim}`);
    assert.equal(plan.payload.notification.tag, 'prospect-today-hard-gate');
    assert.match(plan.payload.notification.body, /Assessment requested: Gate Co · Cloud Technician/);
    assert.notEqual(plan.primary_claim_id, actionClaim);
  } finally {
    db.close();
  }
});

test('older unresolved events do not alarm forever; they fall back into one daily digest', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, {
      company: 'Daily Co',
      action: 'Send follow-up',
      actionDate: '2026-07-29',
      activelyReviewing: 1,
    });
    seedEvent(db, { claimId, dueAt: '2026-07-20' });

    const plan = buildTodayNotificationPlan(db, { today: '2026-07-30' });
    assert.equal(plan.kind, 'daily_digest');
    assert.equal(plan.event_key, 'today-digest:2026-07-30');
    assert.equal(plan.urgency, 'normal');
    assert.equal(plan.payload.notification.navigate, '/diggings');
    assert.match(plan.payload.notification.title, /Today's Diggings · 2 items/);
    assert.match(plan.payload.notification.body, /1 hard gate ahead · Top Nugget/);
  } finally {
    db.close();
  }
});

test('resolved hard gates are excluded from notification planning', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { company: 'Resolved Gate Co' });
    const eventId = seedEvent(db, { claimId, dueAt: '2026-08-01' });
    db.prepare(`
      INSERT INTO claim_events (claim_id, kind, payload)
      VALUES (?, 'deadline_resolved', ?)
    `).run(claimId, JSON.stringify({
      resolved_event_id: eventId,
      resolution_reason: 'completed',
    }));
    assert.equal(buildTodayNotificationPlan(db, { today: '2026-07-30' }), null);
  } finally {
    db.close();
  }
});

test('successful dispatch is deduplicated per subscription and event key', async () => {
  const db = freshDb();
  try {
    seedClaim(db, {
      action: 'Review application',
      actionDate: '2026-07-30',
      activelyReviewing: 1,
    });
    const subscription = subscribe(db);
    let sends = 0;
    let observedOptions = null;
    const transport = async ({ options }) => {
      sends += 1;
      observedOptions = options;
      return { statusCode: 201 };
    };

    await withVapidConfig(async () => {
      const first = await dispatchTodayNotifications(db, { today: '2026-07-30', now: AWAKE_NOW, transport });
      const second = await dispatchTodayNotifications(db, { today: '2026-07-30', now: AWAKE_NOW, transport });

      assert.deepEqual(
        { sent: first.sent, skipped: first.skipped, failed: first.failed },
        { sent: 1, skipped: 0, failed: 0 },
      );
      assert.deepEqual(
        { sent: second.sent, skipped: second.skipped, failed: second.failed },
        { sent: 0, skipped: 1, failed: 0 },
      );
      assert.equal(sends, 1);
      assert.equal(observedOptions.urgency, 'normal');
      assert.equal(observedOptions.ttl, 43_200);
      assert.equal(wasTodayNotificationDelivered(db, 'today-digest:2026-07-30', subscription.id), true);
      assert.equal(db.prepare('SELECT count(*) FROM push_delivery_log').pluck().get(), 1);
    });
  } finally {
    db.close();
  }
});

test('Today category preference suppresses dispatch without deactivating the subscription', async () => {
  const db = freshDb();
  try {
    seedClaim(db, { action: 'Review application', actionDate: '2026-07-30' });
    const subscription = subscribe(db);
    db.prepare('UPDATE push_subscriptions SET today_enabled = 0 WHERE id = ?').run(subscription.id);
    let sends = 0;
    await withVapidConfig(async () => {
      const result = await dispatchTodayNotifications(db, {
        today: '2026-07-30',
        now: new Date('2026-07-30T15:00:00.000Z'),
        transport: async () => {
          sends += 1;
          return { statusCode: 201 };
        },
      });
      assert.equal(result.sent, 0);
      assert.equal(result.reason, 'no active Today subscriptions');
      assert.equal(sends, 0);
      assert.equal(db.prepare('SELECT active FROM push_subscriptions WHERE id = ?').pluck().get(subscription.id), 1);
    });
  } finally {
    db.close();
  }
});

test('quiet-hour Today priority is deferred, then delivered once after the window', async () => {
  const db = freshDb();
  try {
    seedClaim(db, { action: 'Review application', actionDate: '2026-07-29' });
    subscribe(db);
    let sends = 0;
    const transport = async () => {
      sends += 1;
      return { statusCode: 201 };
    };

    await withVapidConfig(async () => {
      const duringQuiet = await dispatchTodayNotifications(db, {
        today: '2026-07-29',
        now: new Date('2026-07-30T04:00:00.000Z'),
        transport,
      });
      assert.equal(duringQuiet.sent, 0);
      assert.equal(duringQuiet.deferred, 1);
      assert.equal(sends, 0);
      assert.equal(db.prepare('SELECT count(*) FROM push_pending_notifications WHERE delivered_at IS NULL').pluck().get(), 1);

      const afterQuiet = await dispatchTodayNotifications(db, {
        today: '2026-07-29',
        now: new Date('2026-07-30T12:00:00.000Z'),
        transport,
      });
      assert.equal(afterQuiet.sent, 1);
      assert.equal(sends, 1);
      assert.equal(db.prepare('SELECT count(*) FROM push_pending_notifications WHERE delivered_at IS NOT NULL').pluck().get(), 1);
      assert.equal(db.prepare("SELECT count(*) FROM push_delivery_log WHERE status = 'success'").pluck().get(), 1);
    });
  } finally {
    db.close();
  }
});

test('failed delivery is retried later because only success suppresses the event key', async () => {
  const db = freshDb();
  try {
    seedClaim(db, { action: 'Review application', actionDate: '2026-07-30' });
    subscribe(db);
    let attempts = 0;

    await withVapidConfig(async () => {
      const first = await dispatchTodayNotifications(db, {
        today: '2026-07-30',
        now: AWAKE_NOW,
        transport: async () => {
          attempts += 1;
          const error = new Error('temporary failure');
          error.statusCode = 500;
          throw error;
        },
      });
      const second = await dispatchTodayNotifications(db, {
        today: '2026-07-30',
        now: AWAKE_NOW,
        transport: async () => {
          attempts += 1;
          return { statusCode: 201 };
        },
      });

      assert.equal(first.failed, 1);
      assert.equal(second.sent, 1);
      assert.equal(attempts, 2);
      assert.equal(db.prepare("SELECT count(*) FROM push_delivery_log WHERE status = 'failed'").pluck().get(), 1);
      assert.equal(db.prepare("SELECT count(*) FROM push_delivery_log WHERE status = 'success'").pluck().get(), 1);
    });
  } finally {
    db.close();
  }
});

test('dry-run returns the exact plan without transport or delivery-log writes', async () => {
  const db = freshDb();
  try {
    seedClaim(db, { action: 'Review application', actionDate: '2026-07-30' });
    subscribe(db);
    let sends = 0;
    const result = await dispatchTodayNotifications(db, {
      today: '2026-07-30',
      dryRun: true,
      transport: async () => {
        sends += 1;
        return { statusCode: 201 };
      },
    });
    assert.equal(result.dry_run, true);
    assert.equal(result.plan.kind, 'daily_digest');
    assert.equal(sends, 0);
    assert.equal(db.prepare('SELECT count(*) FROM push_delivery_log').pluck().get(), 0);
  } finally {
    db.close();
  }
});

test('systemd timer has three quiet retry opportunities and the service uses the live DB', () => {
  const timer = fs.readFileSync(path.join(process.cwd(), 'deploy', 'prospect-today-notifications.timer'), 'utf8');
  const service = fs.readFileSync(path.join(process.cwd(), 'deploy', 'prospect-today-notifications.service'), 'utf8');
  const calendars = timer.match(/^OnCalendar=/gm) || [];

  assert.equal(calendars.length, 3);
  assert.match(timer, /08:30:00 America\/Chicago/);
  assert.match(timer, /12:30:00 America\/Chicago/);
  assert.match(timer, /17:30:00 America\/Chicago/);
  assert.match(timer, /Persistent=true/);
  assert.match(timer, /RandomizedDelaySec=5m/);
  assert.match(service, /PROSPECT_DB_PATH=%h\/prospect\/data\/prospect\.db/);
  assert.match(service, /scripts\/today-notifications\.mjs run/);
});
