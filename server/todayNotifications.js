import { getDailyDiggings, getTodayString } from './diggings.js';
import {
  flushPendingNotifications,
  isSubscriptionQuiet,
  loadVapidConfig,
  queuePendingNotification,
  sendPushNotification,
} from './push.js';

const DAY_MS = 86_400_000;

function dayDelta(today, date) {
  if (!today || !date) return null;
  const from = Date.parse(`${today}T00:00:00Z`);
  const to = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return Math.round((to - from) / DAY_MS);
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function notificationEnvelope({ title, body, navigate, tag, appBadge }) {
  return {
    web_push: 8030,
    notification: {
      title,
      body,
      navigate,
      tag,
      app_badge: appBadge,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
    },
  };
}

function allEventDeadlines(data) {
  return [
    ...data.eventDeadlines.overdue,
    ...data.eventDeadlines.today,
    ...data.eventDeadlines.upcoming,
  ];
}

function rankedActions(data) {
  return [
    ...data.nextActions.overdue,
    ...data.nextActions.today,
    ...data.nextActions.upcoming,
    ...data.nextActions.unscheduled,
  ];
}

export function buildTodayNotificationPlan(db, options = {}) {
  const today = getTodayString(options.today);
  const diggings = getDailyDiggings(db, { today });
  if (diggings.counts.totalCount === 0) return null;

  const events = allEventDeadlines(diggings)
    .map((event) => ({ ...event, day_delta: dayDelta(today, event.date) }))
    .filter((event) => event.day_delta != null)
    .sort((a, b) => a.day_delta - b.day_delta || a.event_id - b.event_id);

  // One bounded escalation per calendar day: two days out, tomorrow, due day, and one
  // day overdue. Older unresolved append-only events fall back into the digest instead
  // of generating an indefinite daily hard-gate alarm.
  const critical = events.filter((event) => event.day_delta >= -1 && event.day_delta <= 2);
  if (critical.length > 0) {
    const primary = critical[0];
    const title = primary.day_delta === -1
      ? 'Hard gate overdue'
      : primary.day_delta === 0
        ? 'Hard gate due today'
        : primary.day_delta === 1
          ? 'Hard gate due tomorrow'
          : 'Hard gate due in 2 days';
    const more = critical.length > 1 ? ` · +${critical.length - 1} more` : '';
    return {
      kind: 'hard_gate',
      event_key: `today-hard-gate:${today}`,
      urgency: 'high',
      ttl: 43_200,
      today,
      primary_claim_id: primary.claim_id,
      critical_count: critical.length,
      payload: notificationEnvelope({
        title,
        body: `${primary.kind_gloss}: ${primary.company} · ${primary.role}${more}`,
        navigate: `/?claim=${primary.claim_id}`,
        tag: 'prospect-today-hard-gate',
        appBadge: diggings.counts.totalCount,
      }),
    };
  }

  const actions = rankedActions(diggings);
  const top = actions[0] || null;
  const gatePrefix = events.length ? `${plural(events.length, 'hard gate')} ahead · ` : '';
  const body = top
    ? `${gatePrefix}Top Nugget ${top.nugget_weight}: ${top.action} · ${top.company}`
    : `${plural(events.length, 'hard gate')} ahead. Open Today to review.`;

  return {
    kind: 'daily_digest',
    event_key: `today-digest:${today}`,
    urgency: 'normal',
    ttl: 43_200,
    today,
    primary_claim_id: top?.claim_id || null,
    critical_count: 0,
    payload: notificationEnvelope({
      title: `Today's Diggings · ${plural(diggings.counts.totalCount, 'item')}`,
      body,
      navigate: '/diggings',
      tag: 'prospect-today-digest',
      appBadge: diggings.counts.totalCount,
    }),
  };
}

export function wasTodayNotificationDelivered(db, eventKey, subscriptionId) {
  const row = db.prepare(`
    SELECT 1
    FROM push_delivery_log
    WHERE event_key = ?
      AND subscription_id = ?
      AND status = 'success'
    LIMIT 1
  `).get(eventKey, subscriptionId);
  return Boolean(row);
}

export async function dispatchTodayNotifications(db, options = {}) {
  const plan = buildTodayNotificationPlan(db, { today: options.today });
  if (options.dryRun) {
    return {
      ok: true,
      dry_run: true,
      sent: 0,
      skipped: 0,
      failed: 0,
      reason: plan ? undefined : 'queue empty',
      plan,
    };
  }

  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const pending = await flushPendingNotifications(db, {
    now,
    transport: options.transport,
  });
  if (!plan) {
    return {
      ok: pending.ok,
      dry_run: false,
      sent: pending.sent,
      deferred: 0,
      skipped: pending.skipped,
      failed: pending.failed,
      reason: 'queue empty',
      pending,
      plan: null,
    };
  }

  const config = loadVapidConfig();
  if (!config.enabled) {
    return {
      ok: false,
      dry_run: false,
      sent: 0,
      skipped: 0,
      failed: 0,
      reason: config.reason || 'VAPID disabled',
      plan,
    };
  }

  const subscriptions = db.prepare(`
    SELECT * FROM push_subscriptions
    WHERE active = 1 AND today_enabled = 1
    ORDER BY id
  `).all();
  if (subscriptions.length === 0) {
    return {
      ok: pending.ok,
      dry_run: false,
      sent: pending.sent,
      deferred: 0,
      skipped: pending.skipped,
      failed: pending.failed,
      reason: 'no active Today subscriptions',
      pending,
      plan,
    };
  }

  let sent = pending.sent;
  let deferred = 0;
  let skipped = pending.skipped;
  let failed = pending.failed;
  const errors = [];
  for (const subscription of subscriptions) {
    if (wasTodayNotificationDelivered(db, plan.event_key, subscription.id)) {
      skipped += 1;
      continue;
    }
    if (isSubscriptionQuiet(subscription, now)) {
      queuePendingNotification(db, subscription, {
        category: 'today',
        eventKey: plan.event_key,
        payload: plan.payload,
        urgency: plan.urgency,
        ttl: plan.ttl,
        now,
      });
      deferred += 1;
      continue;
    }
    const result = await sendPushNotification(db, subscription, plan.payload, {
      eventKey: plan.event_key,
      transport: options.transport,
      urgency: plan.urgency,
      ttl: plan.ttl,
    });
    if (result.ok) {
      sent += 1;
    } else {
      failed += 1;
      errors.push({ statusCode: result.statusCode, error: result.error });
    }
  }

  return {
    ok: failed === 0,
    dry_run: false,
    sent,
    deferred,
    skipped,
    failed,
    errors,
    pending,
    plan,
  };
}
