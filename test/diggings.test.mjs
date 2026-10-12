import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import esbuild from 'esbuild';
import Database from 'better-sqlite3';

import { calculateNuggetWeight, getDailyDiggings, renderDailyDiggingsHtml, getTodayString } from '../server/diggings.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const schemaSql = readFileSync(path.join(repoRoot, 'schema.sql'), 'utf8');
const require = createRequire(import.meta.url);

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedListing(db, {
  company = 'Acme',
  role = 'Engineer',
  topApplicantMatch = null,
  activelyReviewing = null,
} = {}) {
  const info = db.prepare(`
    INSERT INTO listings (source, company, role, top_applicant_match, actively_reviewing)
    VALUES ('Manual', ?, ?, ?, ?)
  `).run(company, role, topApplicantMatch, activelyReviewing);
  return info.lastInsertRowid;
}

function seedClaim(db, {
  listingId,
  stage = 'Staked',
  nextAction = null,
  nextActionDate = null,
  applicationMinutes = null,
  gutPrediction = null,
  referral = null,
}) {
  const info = db.prepare(`
    INSERT INTO claims (
      listing_id, stage, next_action, next_action_date,
      application_minutes, gut_prediction, referral
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(listingId, stage, nextAction, nextActionDate, applicationMinutes, gutPrediction, referral);
  return info.lastInsertRowid;
}

function seedClaimEvent(db, { claimId, kind = 'recruiter_contact', dueAt = null, payload = null }) {
  const info = db.prepare(`
    INSERT INTO claim_events (claim_id, kind, due_at, payload) VALUES (?, ?, ?, ?)
  `).run(claimId, kind, dueAt, payload);
  return info.lastInsertRowid;
}

test('getTodayString default vs injectable', () => {
  assert.equal(getTodayString('2026-07-29'), '2026-07-29');
  assert.equal(getTodayString('2026-07-29T10:00:00Z'), '2026-07-29');
  const todayDefault = getTodayString();
  assert.match(todayDefault, /^\d{4}-\d{2}-\d{2}$/);
});

test('Event deadlines precede next actions, bucketing and deterministic ordering', () => {
  const db = freshDb();
  const l1 = seedListing(db, { company: 'Acme', role: 'Backend' });
  const l2 = seedListing(db, { company: 'Basalt', role: 'Frontend' });

  const c1 = seedClaim(db, { listingId: l1, stage: 'Staked', nextAction: 'Send follow-up', nextActionDate: '2026-07-28' });
  const c2 = seedClaim(db, { listingId: l2, stage: 'Showings', nextAction: 'Prepare portfolio', nextActionDate: '2026-07-30' });

  const e1 = seedClaimEvent(db, { claimId: c2, kind: 'assessment_requested', dueAt: '2026-07-28' });
  const e2 = seedClaimEvent(db, { claimId: c1, kind: 'recruiter_contact', dueAt: '2026-07-29', payload: JSON.stringify({ note: 'Call recruiter' }) });

  const data = getDailyDiggings(db, { today: '2026-07-29' });

  assert.equal(data.today, '2026-07-29');
  assert.equal(data.eventDeadlines.overdue.length, 1);
  assert.equal(data.eventDeadlines.overdue[0].event_id, e1);
  assert.equal(data.eventDeadlines.today.length, 1);
  assert.equal(data.eventDeadlines.today[0].event_id, e2);
  assert.equal(data.eventDeadlines.today[0].note, 'Call recruiter');

  assert.equal(data.nextActions.overdue.length, 1);
  assert.equal(data.nextActions.overdue[0].claim_id, c1);
  assert.equal(data.nextActions.upcoming.length, 1);
  assert.equal(data.nextActions.upcoming[0].claim_id, c2);

  const html = renderDailyDiggingsHtml(data);
  const eventsIdx = html.indexOf('Event Deadlines');
  const actionsIdx = html.indexOf('Next Actions');
  assert.ok(eventsIdx > 0, 'Event Deadlines section present');
  assert.ok(actionsIdx > eventsIdx, 'Event Deadlines precedes Next Actions in HTML');
});

test('Tailings exclusion and Strike inclusion', () => {
  const db = freshDb();
  const l1 = seedListing(db, { company: 'C1', role: 'R1' });
  const l2 = seedListing(db, { company: 'C2', role: 'R2' });

  const cTail = seedClaim(db, { listingId: l1, stage: 'Tailings', nextAction: 'Do not show', nextActionDate: '2026-07-20' });
  seedClaimEvent(db, { claimId: cTail, kind: 'status_check', dueAt: '2026-07-20' });

  const cStrike = seedClaim(db, { listingId: l2, stage: 'Strike', nextAction: 'Review offer', nextActionDate: '2026-07-29' });
  const eStrike = seedClaimEvent(db, { claimId: cStrike, kind: 'employer_email', dueAt: '2026-07-29' });

  const data = getDailyDiggings(db, { today: '2026-07-29' });

  const allEvents = [...data.eventDeadlines.overdue, ...data.eventDeadlines.today, ...data.eventDeadlines.upcoming];
  const allActions = [...data.nextActions.overdue, ...data.nextActions.today, ...data.nextActions.upcoming, ...data.nextActions.unscheduled];

  assert.ok(!allEvents.some(e => e.claim_id === cTail), 'Tailings claim events excluded');
  assert.ok(!allActions.some(a => a.claim_id === cTail), 'Tailings claim next actions excluded');

  assert.ok(allEvents.some(e => e.claim_id === cStrike), 'Strike claim event included');
  assert.ok(allActions.some(a => a.claim_id === cStrike), 'Strike claim next action included');
});

test('Date-only next_action fallback and unscheduled bucket', () => {
  const db = freshDb();
  const l1 = seedListing(db, { company: 'Acme', role: 'Dev' });

  const c1 = seedClaim(db, { listingId: l1, stage: 'Staked', nextAction: null, nextActionDate: '2026-07-28' });
  const c2 = seedClaim(db, { listingId: l1, stage: 'Working the Vein', nextAction: 'Schedule interview', nextActionDate: null });

  const data = getDailyDiggings(db, { today: '2026-07-29' });

  assert.equal(data.nextActions.overdue.length, 1);
  assert.equal(data.nextActions.overdue[0].claim_id, c1);
  assert.equal(data.nextActions.overdue[0].action, 'Review next action');

  assert.equal(data.nextActions.unscheduled.length, 1);
  assert.equal(data.nextActions.unscheduled[0].claim_id, c2);
  assert.equal(data.nextActions.unscheduled[0].action, 'Schedule interview');
});

test('Nugget weight is deterministic, bounded, and transparent', () => {
  const result = calculateNuggetWeight({
    bucket: 'today',
    date: '2026-07-29',
    stage: 'Working the Vein',
    application_minutes: 15,
    gut_prediction: 0.7,
    referral: 1,
    top_applicant_match: 1,
    actively_reviewing: 1,
  }, '2026-07-29');

  assert.equal(result.raw_weight, 98);
  assert.equal(result.weight, 98);
  assert.deepEqual(result.factors.map((factor) => factor.key), [
    'urgency', 'stage', 'effort', 'gut', 'referral', 'top_match', 'active',
  ]);
  assert.deepEqual(result.factors.map((factor) => factor.delta), [28, 34, 0, 14, 8, 8, 6]);

  const heavy = calculateNuggetWeight({
    bucket: 'unscheduled',
    date: null,
    stage: 'Showings',
    application_minutes: 180,
  }, '2026-07-29');
  assert.equal(heavy.weight, 8);
  assert.equal(heavy.factors.find((factor) => factor.key === 'effort').delta, -4);

  const capped = calculateNuggetWeight({
    bucket: 'overdue',
    date: '2026-07-01',
    stage: 'Strike',
    application_minutes: 5,
    gut_prediction: 1,
    referral: 1,
    top_applicant_match: 1,
    actively_reviewing: 1,
  }, '2026-07-29');
  assert.ok(capped.raw_weight > 100);
  assert.equal(capped.weight, 100, 'display weight is capped at 100');
});

test('Nugget weight sorts within urgency buckets while hard-gate events remain separate', () => {
  const db = freshDb();
  const ordinaryListing = seedListing(db, { company: 'Ordinary', role: 'Support' });
  const strongListing = seedListing(db, {
    company: 'Strong',
    role: 'Engineer',
    topApplicantMatch: 1,
    activelyReviewing: 1,
  });

  const ordinary = seedClaim(db, {
    listingId: ordinaryListing,
    stage: 'Staked',
    nextAction: 'Long application',
    nextActionDate: '2026-07-28',
    applicationMinutes: 180,
  });
  const strong = seedClaim(db, {
    listingId: strongListing,
    stage: 'Working the Vein',
    nextAction: 'Quick recruiter reply',
    nextActionDate: '2026-07-28',
    applicationMinutes: 10,
    gutPrediction: 0.75,
    referral: 1,
  });
  seedClaimEvent(db, {
    claimId: ordinary,
    kind: 'assessment_requested',
    dueAt: '2026-07-30',
  });

  const data = getDailyDiggings(db, { today: '2026-07-29' });

  assert.equal(data.eventDeadlines.upcoming.length, 1, 'hard gate remains in the first queue group');
  assert.deepEqual(data.nextActions.overdue.map((item) => item.claim_id), [strong, ordinary]);
  assert.ok(data.nextActions.overdue[0].nugget_weight > data.nextActions.overdue[1].nugget_weight);
  assert.equal(data.nextActions.overdue[0].nugget_factors.find((factor) => factor.key === 'gut').delta, 15);

  const html = renderDailyDiggingsHtml(data);
  assert.match(html, /Hard gate/);
  assert.match(html, /Employer-imposed deadline/);
  assert.match(html, /Nugget \d+/);
  assert.match(html, /Time invested · 10m \+0/);
  assert.ok(html.indexOf('Event Deadlines') < html.indexOf('Next Actions'));
});

test('Scripts-off HTML contains deep links, brand lockup, active nav state', () => {
  const db = freshDb();
  const l1 = seedListing(db, { company: 'Starlight', role: 'Architect' });
  const c1 = seedClaim(db, { listingId: l1, stage: 'Working the Vein', nextAction: 'Verify salary', nextActionDate: '2026-07-29' });
  seedClaimEvent(db, { claimId: c1, kind: 'recruiter_contact', dueAt: '2026-07-29' });

  const data = getDailyDiggings(db, { today: '2026-07-29' });
  const html = renderDailyDiggingsHtml(data);

  assert.match(html, /<a href="\/\?claim=1" class="claim-link">Claim #1<\/a>/);
  assert.match(html, /<img class="report-wordmark" src="\/brand\/prospect-lockup\.svg" alt="Prospect">/);
  assert.match(html, /<a href="\/diggings" class="nav-item is-active">/);
  assert.match(html, /btn-mark-done/);
  assert.match(html, /input-reschedule/);
  assert.match(html, /Nugget \d+/);
  assert.match(html, /Self-authored actions ranked within each urgency bucket by visible Nugget factors/);
  assert.match(html, /btn-resolve-gate/);
  assert.match(html, /select-resolution/);
});

test('server/index.js keeps claim events append-only while exposing a resolution route', () => {
  const indexSrc = readFileSync(path.join(repoRoot, 'server/index.js'), 'utf8');
  const diggingsRoute = indexSrc.indexOf("app.get('/diggings'");
  const apiDiggingsRoute = indexSrc.indexOf("app.get('/api/diggings'");
  const spaCatchAll = indexSrc.indexOf("app.get(/^(?!\\/api\\/).*");

  assert.ok(diggingsRoute > 0, '/diggings route exists');
  assert.ok(apiDiggingsRoute > 0, '/api/diggings route exists');
  assert.ok(spaCatchAll > diggingsRoute, '/diggings is before SPA catch-all');
  assert.ok(spaCatchAll > apiDiggingsRoute, '/api/diggings is before SPA catch-all');

  assert.match(indexSrc, /events\/:eventId\/resolve/, 'append-only deadline resolution route exists');
  assert.doesNotMatch(indexSrc, /UPDATE\s+claim_events/i, 'No UPDATE path for claim_events');
  assert.doesNotMatch(indexSrc, /DELETE\s+FROM\s+claim_events\s+WHERE\s+id\s*=/i, 'No single-event DELETE path for claim_events');
});

test('resolved hard gates disappear from Today without changing the original event', () => {
  const db = freshDb();
  const listingId = seedListing(db, { company: 'Resolved Co', role: 'Support Engineer' });
  const claimId = seedClaim(db, { listingId, stage: 'Staked' });
  const eventId = seedClaimEvent(db, {
    claimId, kind: 'recruiter_contact', dueAt: '2026-07-30', payload: JSON.stringify({ note: 'Reply' }),
  });
  db.prepare(`
    INSERT INTO claim_events (claim_id, kind, payload)
    VALUES (?, 'deadline_resolved', ?)
  `).run(claimId, JSON.stringify({
    resolved_event_id: eventId,
    resolution_reason: 'completed',
  }));

  const data = getDailyDiggings(db, { today: '2026-07-30' });
  assert.equal(data.counts.eventDeadlinesCount, 0);
  assert.equal(data.counts.totalCount, 0);
  const original = db.prepare('SELECT * FROM claim_events WHERE id=?').get(eventId);
  assert.equal(original.due_at, '2026-07-30');
  assert.equal(original.payload, '{"note":"Reply"}');
});

test('App.jsx query deep-link parsing and parameter-preserving close regression', () => {
  const bundlePath = path.join(__dirname, '.app-test-bundle.cjs');
  const result = esbuild.buildSync({
    entryPoints: [path.join(repoRoot, 'app/src/App.jsx')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    loader: { '.css': 'empty', '.svg': 'text' },
    external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'better-sqlite3'],
    alias: { '@ds': path.join(repoRoot, 'design-system') },
    logLevel: 'silent',
  });

  fs.writeFileSync(bundlePath, result.outputFiles[0].text);
  try {
    delete require.cache[require.resolve(bundlePath)];
    const { parseInitialClaimId, stripClaimParam } = require(bundlePath);

    assert.equal(parseInitialClaimId('?claim=12'), 12);
    assert.equal(parseInitialClaimId('?source=pwa&claim=7'), 7);
    assert.equal(parseInitialClaimId('?claim=abc'), null);
    assert.equal(parseInitialClaimId('?claim=0'), null);
    assert.equal(parseInitialClaimId('?claim=-5'), null);
    assert.equal(parseInitialClaimId(''), null);
    assert.equal(parseInitialClaimId('?other=true'), null);

    assert.equal(stripClaimParam('?claim=12'), '');
    assert.equal(stripClaimParam('?source=pwa&claim=12'), '?source=pwa');
    assert.equal(stripClaimParam('?a=1&claim=12&b=2'), '?a=1&b=2');
    assert.equal(stripClaimParam('?source=pwa'), '?source=pwa');
    assert.equal(stripClaimParam(''), '');
  } finally {
    fs.rmSync(bundlePath, { force: true });
  }

  const appSource = readFileSync(path.join(repoRoot, 'app/src/App.jsx'), 'utf8');
  assert.match(appSource, /parseInitialClaimId\(window\.location\.search\)/);
  assert.match(appSource, /stripClaimParam\(window\.location\.search\)/);
  assert.match(appSource, /window\.history\.replaceState/);
});
