import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_VAPID_PATH = path.join(__dirname, '..', 'data', 'push', 'vapid.json');
const CHICAGO_TIME_ZONE = 'America/Chicago';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function getVapidConfigPath() {
  return process.env.PROSPECT_VAPID_PATH || DEFAULT_VAPID_PATH;
}

export function loadVapidConfig() {
  const vapidPath = getVapidConfigPath();
  try {
    if (!fs.existsSync(vapidPath)) {
      return { enabled: false, reason: 'VAPID key file absent' };
    }
    const raw = fs.readFileSync(vapidPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed.publicKey || !parsed.privateKey || !parsed.subject) {
      return { enabled: false, reason: 'VAPID key file invalid' };
    }
    return {
      enabled: true,
      subject: parsed.subject,
      publicKey: parsed.publicKey,
      privateKey: parsed.privateKey,
      path: vapidPath,
    };
  } catch (err) {
    return { enabled: false, reason: err.message };
  }
}

export function ensureVapidKeys() {
  const vapidPath = getVapidConfigPath();
  const dirPath = path.dirname(vapidPath);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(dirPath, 0o700);
  if (!fs.existsSync(vapidPath)) {
    const keys = webpush.generateVAPIDKeys();
    const config = {
      subject: 'mailto:owner@example.com',
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
    };
    fs.writeFileSync(vapidPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  }
  fs.chmodSync(vapidPath, 0o600);
  return loadVapidConfig();
}

function isValidBase64Url(str) {
  if (typeof str !== 'string' || !str) return false;
  return /^[A-Za-z0-9_-]+=*$/.test(str) || /^[A-Za-z0-9+/]+=*$/.test(str);
}

export function validateSubscriptionInput({ endpoint, p256dh, auth }) {
  if (typeof endpoint !== 'string' || endpoint.length > 2048) {
    return { valid: false, error: 'Endpoint must be a string <= 2048 chars' };
  }
  try {
    const url = new URL(endpoint);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
      return { valid: false, error: 'Endpoint must use HTTPS' };
    }
  } catch {
    return { valid: false, error: 'Endpoint is an invalid URL' };
  }

  if (typeof p256dh !== 'string' || p256dh.length > 256 || !isValidBase64Url(p256dh)) {
    return { valid: false, error: 'p256dh must be a valid base64 string <= 256 chars' };
  }

  if (typeof auth !== 'string' || auth.length > 256 || !isValidBase64Url(auth)) {
    return { valid: false, error: 'auth must be a valid base64 string <= 256 chars' };
  }

  return { valid: true };
}

export function upsertSubscription(db, { endpoint, p256dh, auth, userAgent }) {
  const validation = validateSubscriptionInput({ endpoint, p256dh, auth });
  if (!validation.valid) {
    return { ok: false, error: validation.error };
  }
  const cleanUserAgent = typeof userAgent === 'string' ? userAgent.slice(0, 512) : null;
  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, active, failure_count, updated_at)
    VALUES (?, ?, ?, ?, 1, 0, datetime('now'))
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      active = 1,
      failure_count = 0,
      updated_at = datetime('now')
  `).run(endpoint, p256dh, auth, cleanUserAgent);
  return { ok: true };
}

export function deactivateSubscription(db, endpoint) {
  if (typeof endpoint !== 'string') return { ok: false, error: 'Endpoint required' };
  db.prepare(`
    UPDATE push_subscriptions
    SET active = 0, updated_at = datetime('now')
    WHERE endpoint = ?
  `).run(endpoint);
  return { ok: true };
}

export function getSubscriptionStatus(db, endpoint) {
  if (typeof endpoint !== 'string') return { subscribed: false };
  const row = db.prepare(`
    SELECT active, scout_enabled, today_enabled, quiet_hours_enabled, quiet_start, quiet_end
    FROM push_subscriptions
    WHERE endpoint = ?
  `).get(endpoint);
  return {
    subscribed: Boolean(row?.active),
    preferences: row ? {
      scout_enabled: Boolean(row.scout_enabled),
      today_enabled: Boolean(row.today_enabled),
      quiet_hours_enabled: Boolean(row.quiet_hours_enabled),
      quiet_start: row.quiet_start,
      quiet_end: row.quiet_end,
      timezone: CHICAGO_TIME_ZONE,
    } : null,
  };
}

function cleanBoolean(value, name) {
  if (typeof value !== 'boolean') throw new Error(`${name} must be boolean`);
  return value ? 1 : 0;
}

export function updateSubscriptionPreferences(db, endpoint, input = {}) {
  if (typeof endpoint !== 'string' || !endpoint) {
    return { ok: false, status: 400, error: 'endpoint string required' };
  }
  const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ? AND active = 1').get(endpoint);
  if (!existing) return { ok: false, status: 404, error: 'No active subscription found for endpoint' };

  try {
    const scoutEnabled = cleanBoolean(input.scout_enabled, 'scout_enabled');
    const todayEnabled = cleanBoolean(input.today_enabled, 'today_enabled');
    const quietHoursEnabled = cleanBoolean(input.quiet_hours_enabled, 'quiet_hours_enabled');
    if (!TIME_RE.test(input.quiet_start || '')) throw new Error('quiet_start must use HH:MM');
    if (!TIME_RE.test(input.quiet_end || '')) throw new Error('quiet_end must use HH:MM');

    db.prepare(`
      UPDATE push_subscriptions
      SET scout_enabled = ?,
          today_enabled = ?,
          quiet_hours_enabled = ?,
          quiet_start = ?,
          quiet_end = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(
      scoutEnabled,
      todayEnabled,
      quietHoursEnabled,
      input.quiet_start,
      input.quiet_end,
      existing.id,
    );
    return { ok: true, ...getSubscriptionStatus(db, endpoint) };
  } catch (err) {
    return { ok: false, status: 400, error: err.message };
  }
}

function zonedMinuteOfDay(date, timeZone = CHICAGO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  return hour * 60 + minute;
}

function timeToMinutes(value) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

export function isSubscriptionQuiet(subscription, now = new Date()) {
  if (!subscription.quiet_hours_enabled) return false;
  if (!TIME_RE.test(subscription.quiet_start || '') || !TIME_RE.test(subscription.quiet_end || '')) return false;
  const start = timeToMinutes(subscription.quiet_start);
  const end = timeToMinutes(subscription.quiet_end);
  if (start === end) return false;
  const current = zonedMinuteOfDay(now);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

export function nextAllowedNotificationMs(subscription, now = new Date()) {
  if (!isSubscriptionQuiet(subscription, now)) return now.getTime();
  const candidate = new Date(now.getTime());
  candidate.setUTCSeconds(0, 0);
  for (let minute = 1; minute <= 2_880; minute += 1) {
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
    if (!isSubscriptionQuiet(subscription, candidate)) return candidate.getTime();
  }
  return now.getTime() + 86_400_000;
}

export function queuePendingNotification(db, subscription, {
  category,
  eventKey,
  payload,
  urgency = 'normal',
  ttl = 43_200,
  now = new Date(),
}) {
  const notBeforeMs = nextAllowedNotificationMs(subscription, now);
  db.prepare(`
    INSERT INTO push_pending_notifications (
      subscription_id, category, event_key, payload, urgency, ttl, not_before_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(subscription_id, event_key) DO UPDATE SET
      payload = excluded.payload,
      urgency = excluded.urgency,
      ttl = excluded.ttl,
      not_before_ms = excluded.not_before_ms
    WHERE push_pending_notifications.delivered_at IS NULL
  `).run(
    subscription.id,
    category,
    eventKey,
    JSON.stringify(payload),
    urgency,
    ttl,
    notBeforeMs,
  );
  return { queued: true, not_before_ms: notBeforeMs };
}

export function pruneDeliveryLog(db) {
  try {
    db.prepare(`
      DELETE FROM push_delivery_log
      WHERE id NOT IN (
        SELECT id FROM push_delivery_log ORDER BY id DESC LIMIT 500
      )
    `).run();
  } catch (err) {
    // Non-fatal
  }
}

export function buildScoutPushPayload({ title, body, newJobsCount = 1, totalNewCount = 1, bestJob = null }) {
  let bodyText = body;
  if (!bodyText) {
    if (bestJob && bestJob.role) {
      bodyText = bestJob.company ? `${bestJob.role} at ${bestJob.company}` : bestJob.role;
    } else {
      bodyText = 'Open Scout to review ranked matches.';
    }
  }
  const notificationTitle = title || `Scout found ${newJobsCount} new lead${newJobsCount === 1 ? '' : 's'}`;

  return {
    web_push: 8030,
    notification: {
      title: notificationTitle,
      body: bodyText,
      navigate: '/scout?status=new',
      tag: 'scout-daily-leads',
      app_badge: totalNewCount,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    },
  };
}

export function buildScoutStalePayload({ daysStale, lastIngestAt }) {
  const whole = Math.floor(daysStale);
  return {
    web_push: 8030,
    notification: {
      title: `Scout has not received alerts in ${whole} day${whole === 1 ? '' : 's'}`,
      body: lastIngestAt
        ? `Last accepted alert mail: ${lastIngestAt.slice(0, 10)}. Ingestion may be broken.`
        : 'Ingestion may be broken.',
      navigate: '/scout',
      tag: 'scout-ingestion-stale',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    },
  };
}

// Fires once when ingestion crosses the staleness threshold, then re-fires weekly while it stays
// broken. The event key is derived from the LAST INGEST date rather than today, so a single outage
// produces one alert (plus weekly reminders) instead of a daily nag -- and a later outage gets a
// fresh key automatically because the last-ingest date has moved. No new state table is needed;
// push_delivery_log's event_key already provides the idempotency.
//
// The weekly reminder is deliberate: a single missed notification would silently restore exactly
// the fail-quiet behaviour this whole feature exists to remove.
export async function notifyScoutIngestionStale(db, {
  daysStale,
  lastIngestAt,
  thresholdDays,
  transport,
  now = new Date(),
} = {}) {
  const config = loadVapidConfig();
  if (!config.enabled) {
    return { ok: false, sent: 0, failed: 0, reason: config.reason || 'VAPID disabled' };
  }

  const subscriptions = db.prepare(`
    SELECT * FROM push_subscriptions
    WHERE active = 1 AND scout_enabled = 1
  `).all();
  if (subscriptions.length === 0) {
    return { ok: true, sent: 0, failed: 0, reason: 'no active subscriptions' };
  }

  const weekIndex = Math.floor((daysStale - thresholdDays) / 7);
  const eventKey = `scout-ingestion-stale:${String(lastIngestAt).slice(0, 10)}:w${weekIndex}`;
  const payload = buildScoutStalePayload({ daysStale, lastIngestAt });

  let sent = 0;
  let deferred = 0;
  let failed = 0;
  const errors = [];

  for (const sub of subscriptions) {
    if (isSubscriptionQuiet(sub, now)) {
      queuePendingNotification(db, sub, {
        category: 'scout',
        eventKey,
        payload,
        urgency: 'normal',
        ttl: 86_400,
        now,
      });
      deferred += 1;
      continue;
    }
    try {
      const prior = db.prepare(`
        SELECT 1 FROM push_delivery_log
        WHERE event_key = ? AND subscription_id = ? AND status = 'success'
        LIMIT 1
      `).get(eventKey, sub.id);
      if (prior) continue;
      const res = await sendPushNotification(db, sub, payload, { transport, eventKey });
      if (res.ok) {
        sent += 1;
      } else {
        failed += 1;
        errors.push({ statusCode: res.statusCode, error: res.error });
      }
    } catch (err) {
      failed += 1;
      errors.push({ error: err.message });
    }
  }

  return { ok: true, sent, deferred, failed, event_key: eventKey, errors };
}

export async function sendPushNotification(db, subscription, payload, options = {}) {
  const config = loadVapidConfig();
  if (!config.enabled) {
    return { ok: false, error: config.reason || 'VAPID disabled' };
  }

  const transport = options.transport || (async ({ sub, payloadJson }) => {
    return webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      payloadJson,
      {
        vapidDetails: {
          subject: config.subject,
          publicKey: config.publicKey,
          privateKey: config.privateKey,
        },
        TTL: options.ttl ?? 86400,
        urgency: options.urgency || 'normal',
        timeout: 10000,
      }
    );
  });

  const payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const eventKey = options.eventKey || 'scout-daily-leads';

  try {
    const res = await transport({ sub: subscription, payloadJson, options });
    const statusCode = res?.statusCode || 201;

    db.prepare(`
      UPDATE push_subscriptions
      SET last_success_at = datetime('now'), failure_count = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(subscription.id);

    db.prepare(`
      INSERT INTO push_delivery_log (kind, event_key, subscription_id, status, status_code, detail)
      VALUES ('notification', ?, ?, 'success', ?, 'delivered successfully')
    `).run(eventKey, subscription.id, statusCode);

    pruneDeliveryLog(db);
    return { ok: true, statusCode };
  } catch (err) {
    const statusCode = err.statusCode || err.status || null;
    const detailMsg = (err.message || 'push send failed').slice(0, 500);

    if (statusCode === 404 || statusCode === 410 || statusCode === 403) {
      db.prepare(`
        UPDATE push_subscriptions
        SET active = 0, last_failure_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(subscription.id);
    } else {
      db.prepare(`
        UPDATE push_subscriptions
        SET failure_count = failure_count + 1, last_failure_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(subscription.id);

      db.prepare(`
        UPDATE push_subscriptions
        SET active = 0
        WHERE id = ? AND failure_count >= 5
      `).run(subscription.id);
    }

    db.prepare(`
      INSERT INTO push_delivery_log (kind, event_key, subscription_id, status, status_code, detail)
      VALUES ('notification', ?, ?, 'failed', ?, ?)
    `).run(eventKey, subscription.id, statusCode, detailMsg);

    pruneDeliveryLog(db);
    return { ok: false, statusCode, error: detailMsg };
  }
}

export async function flushPendingNotifications(db, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const rows = db.prepare(`
    SELECT
      pending.id AS pending_id,
      pending.subscription_id,
      pending.category,
      pending.event_key,
      pending.payload,
      pending.urgency,
      pending.ttl,
      subscriptions.*
    FROM push_pending_notifications pending
    JOIN push_subscriptions subscriptions ON subscriptions.id = pending.subscription_id
    WHERE pending.delivered_at IS NULL
      AND pending.not_before_ms <= ?
      AND subscriptions.active = 1
    ORDER BY pending.id
  `).all(now.getTime());
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const row of rows) {
    const categoryEnabled = row.category === 'scout' ? row.scout_enabled : row.today_enabled;
    if (!categoryEnabled) {
      skipped += 1;
      continue;
    }
    if (isSubscriptionQuiet(row, now)) {
      db.prepare('UPDATE push_pending_notifications SET not_before_ms = ? WHERE id = ?')
        .run(nextAllowedNotificationMs(row, now), row.pending_id);
      skipped += 1;
      continue;
    }
    const delivered = db.prepare(`
      SELECT 1 FROM push_delivery_log
      WHERE event_key = ? AND subscription_id = ? AND status = 'success'
      LIMIT 1
    `).get(row.event_key, row.subscription_id);
    if (delivered) {
      db.prepare("UPDATE push_pending_notifications SET delivered_at = datetime('now') WHERE id = ?").run(row.pending_id);
      skipped += 1;
      continue;
    }
    const result = await sendPushNotification(db, row, JSON.parse(row.payload), {
      eventKey: row.event_key,
      transport: options.transport,
      urgency: row.urgency,
      ttl: row.ttl,
    });
    if (result.ok) {
      db.prepare("UPDATE push_pending_notifications SET delivered_at = datetime('now') WHERE id = ?").run(row.pending_id);
      sent += 1;
    } else {
      failed += 1;
    }
  }
  return { ok: failed === 0, sent, skipped, failed };
}

export async function notifyScoutNewLeads(db, {
  newJobsCount,
  totalNewCount,
  bestJob,
  transport,
  now = new Date(),
} = {}) {
  if (!newJobsCount || newJobsCount <= 0) {
    return { ok: true, sent: 0, failed: 0, reason: 'no new jobs' };
  }

  const config = loadVapidConfig();
  if (!config.enabled) {
    return { ok: false, sent: 0, failed: 0, reason: config.reason || 'VAPID disabled' };
  }

  const subscriptions = db.prepare(`
    SELECT * FROM push_subscriptions
    WHERE active = 1 AND scout_enabled = 1
  `).all();
  if (subscriptions.length === 0) {
    return { ok: true, sent: 0, failed: 0, reason: 'no active subscriptions' };
  }

  const payload = buildScoutPushPayload({ newJobsCount, totalNewCount, bestJob });
  const chicagoDay = new Intl.DateTimeFormat('en-CA', {
    timeZone: CHICAGO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const eventKey = `scout-daily-leads:${chicagoDay}`;
  let sent = 0;
  let deferred = 0;
  let failed = 0;
  const errors = [];

  for (const sub of subscriptions) {
    if (isSubscriptionQuiet(sub, now)) {
      queuePendingNotification(db, sub, {
        category: 'scout',
        eventKey,
        payload,
        urgency: 'normal',
        ttl: 86_400,
        now,
      });
      deferred += 1;
      continue;
    }
    try {
      const prior = db.prepare(`
        SELECT 1 FROM push_delivery_log
        WHERE event_key = ? AND subscription_id = ? AND status = 'success'
        LIMIT 1
      `).get(eventKey, sub.id);
      if (prior) continue;
      const res = await sendPushNotification(db, sub, payload, { transport, eventKey });
      if (res.ok) {
        sent += 1;
      } else {
        failed += 1;
        errors.push({ statusCode: res.statusCode, error: res.error });
      }
    } catch (err) {
      failed += 1;
      errors.push({ error: err.message });
    }
  }

  return { ok: true, sent, deferred, failed, errors };
}
