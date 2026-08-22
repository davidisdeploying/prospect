import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { getHuntReport, renderHuntReportHtml } from '../server/huntReport.js';
import { STAGES } from '../server/db.js';
import { loadVecExtension } from '../server/vecExtension.js';
import { isGhostCandidate } from '../app/src/ghost.js';
import { recordObservation } from '../server/vendorStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

const PURGED_STAGE = 'A' + 'ssay';
const PURGED_STAGE_LOWER = 'a' + 'ssay';

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ${actual} to be close to ${expected}`);
}

function seedClaim(db, {
  company, role, stage, stageEnteredAt, nextActionDate,
  applicantsPerDay = null, compDisclosed = 0, annualCompMid = null,
  appliedAt = null, daysPostedAtApply = null,
}) {
  const listingInfo = db.prepare(`
    INSERT INTO listings (source, company, role, applicants_per_day, comp_disclosed, annual_comp_mid)
    VALUES ('Manual', ?, ?, ?, ?, ?)
  `).run(company, role, applicantsPerDay, compDisclosed, annualCompMid);
  const listingId = listingInfo.lastInsertRowid;
  const claimInfo = db.prepare(`
    INSERT INTO claims (listing_id, stage, stage_entered_at, next_action, next_action_date, applied_at, days_posted_at_apply)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(listingId, stage, stageEnteredAt, nextActionDate ? 'Follow up' : null, nextActionDate ?? null, appliedAt, daysPostedAtApply);
  return claimInfo.lastInsertRowid;
}

function addTransition(db, claimId, fromStage, toStage, transitionedAt, outcomeReason = null) {
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause, outcome_reason)
    VALUES (?, ?, ?, ?, 'manual', ?)
  `).run(claimId, fromStage, toStage, transitionedAt, outcomeReason);
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

function seedFixture(db) {
  // Acme Staff Engineer — full traverse: Showings -> Staked -> Working the Vein -> Strike.
  const acme = seedClaim(db, {
    company: 'Acme', role: 'Staff Engineer', stage: 'Strike', stageEnteredAt: '2026-07-09 09:00:00',
    applicantsPerDay: 5, compDisclosed: 1, annualCompMid: 150000,
    appliedAt: '2026-07-02 09:00:00', daysPostedAtApply: 1,
  });
  addTransition(db, acme, null, 'Showings', '2026-07-01 09:00:00');
  addTransition(db, acme, 'Showings', 'Staked', '2026-07-02 09:00:00');
  addTransition(db, acme, 'Staked', 'Working the Vein', '2026-07-04 09:00:00');
  addTransition(db, acme, 'Working the Vein', 'Strike', '2026-07-09 09:00:00');

  // Basalt Backend — Showings -> Staked -> Tailings (rejected).
  const basalt = seedClaim(db, {
    company: 'Basalt', role: 'Backend', stage: 'Tailings', stageEnteredAt: '2026-07-06 09:00:00',
    applicantsPerDay: 25, compDisclosed: 1, annualCompMid: 110000,
    appliedAt: '2026-07-04 09:00:00', daysPostedAtApply: 5,
  });
  addTransition(db, basalt, null, 'Showings', '2026-07-03 09:00:00');
  addTransition(db, basalt, 'Showings', 'Staked', '2026-07-04 09:00:00');
  addTransition(db, basalt, 'Staked', 'Tailings', '2026-07-06 09:00:00', 'rejected');

  // Quartzline Platform — Showings -> Staked -> Working the Vein, still active.
  const quartzline = seedClaim(db, {
    company: 'Quartzline', role: 'Platform', stage: 'Working the Vein', stageEnteredAt: '2026-07-13 09:00:00',
    nextActionDate: daysAgo(1),
    applicantsPerDay: 80, compDisclosed: 1, annualCompMid: 130000,
    appliedAt: '2026-07-11 09:00:00', daysPostedAtApply: 10,
  });
  addTransition(db, quartzline, null, 'Showings', '2026-07-10 09:00:00');
  addTransition(db, quartzline, 'Showings', 'Staked', '2026-07-11 09:00:00');
  addTransition(db, quartzline, 'Staked', 'Working the Vein', '2026-07-13 09:00:00');

  // Diorite Infra — Showings -> Staked, no response yet.
  const diorite = seedClaim(db, {
    company: 'Diorite', role: 'Infra', stage: 'Staked', stageEnteredAt: '2026-07-12 09:00:00',
    applicantsPerDay: 15, compDisclosed: 1, annualCompMid: 95000,
    appliedAt: '2026-07-12 09:00:00', daysPostedAtApply: 3,
  });
  addTransition(db, diorite, null, 'Showings', '2026-07-11 09:00:00');
  addTransition(db, diorite, 'Showings', 'Staked', '2026-07-12 09:00:00');

  // Feldspar Data — Showings -> Staked -> Working the Vein -> Tailings. Reached Working the Vein.
  const feldspar = seedClaim(db, {
    company: 'Feldspar', role: 'Data', stage: 'Tailings', stageEnteredAt: '2026-07-16 09:00:00',
    applicantsPerDay: 60, compDisclosed: 1, annualCompMid: 170000,
    appliedAt: '2026-07-14 09:00:00', daysPostedAtApply: 1,
  });
  addTransition(db, feldspar, null, 'Showings', '2026-07-13 09:00:00');
  addTransition(db, feldspar, 'Showings', 'Staked', '2026-07-14 09:00:00');
  addTransition(db, feldspar, 'Staked', 'Working the Vein', '2026-07-15 09:00:00');
  addTransition(db, feldspar, 'Working the Vein', 'Tailings', '2026-07-16 09:00:00', 'rejected');

  return { acme, basalt, quartzline, diorite, feldspar };
}

function seedThinCompFixture(db) {
  const a = seedClaim(db, {
    company: 'Thin Co', role: 'Engineer', stage: 'Staked', stageEnteredAt: '2026-07-02 09:00:00',
    compDisclosed: 1, annualCompMid: 100000, appliedAt: '2026-07-02 09:00:00',
  });
  addTransition(db, a, null, 'Showings', '2026-07-01 09:00:00');
  addTransition(db, a, 'Showings', 'Staked', '2026-07-02 09:00:00');

  const b = seedClaim(db, {
    company: 'Sparse Inc', role: 'Analyst', stage: 'Staked', stageEnteredAt: '2026-07-03 09:00:00',
    compDisclosed: 1, annualCompMid: 90000, appliedAt: '2026-07-03 09:00:00',
  });
  addTransition(db, b, null, 'Showings', '2026-07-02 09:00:00');
  addTransition(db, b, 'Showings', 'Staked', '2026-07-03 09:00:00');
}

function rowCounts(db) {
  return {
    claims: db.prepare('SELECT count(*) AS n FROM claims').get().n,
    listings: db.prepare('SELECT count(*) AS n FROM listings').get().n,
    stage_transitions: db.prepare('SELECT count(*) AS n FROM stage_transitions').get().n,
  };
}

test('funnel: ever-reached counts come from the transitions log, not claims.stage', () => {
  const db = freshDb();
  seedFixture(db);
  const report = getHuntReport(db);
  const byStage = Object.fromEntries(report.funnel.map((f) => [f.stage, f.count]));
  assert.deepEqual(byStage, {
    Showings: 5, Staked: 5, 'Working the Vein': 3, Strike: 1, Tailings: 2,
  });
  assert.equal(byStage[PURGED_STAGE], undefined, 'Purged stage must not exist in funnel report');
});

test('response_latency: picks up response transitions and excludes no-response claim', () => {
  const db = freshDb();
  seedFixture(db);
  const { response_latency } = getHuntReport(db);
  assert.equal(response_latency.sample_count, 4);
  assert.equal(response_latency.median_days, 2);
});

test('aging: only still-active claims (excludes Strike and Tailings)', () => {
  const db = freshDb();
  seedFixture(db);
  const { aging } = getHuntReport(db);
  assert.equal(aging.length, 2);
  const companies = aging.map((a) => a.company);
  assert.deepEqual(new Set(companies), new Set(['Quartzline', 'Diorite']));
  assert.deepEqual(companies, ['Diorite', 'Quartzline']);
});

test('action_queue: flags Quartzline overdue', () => {
  const db = freshDb();
  seedFixture(db);
  const { action_queue } = getHuntReport(db);
  assert.equal(action_queue.length, 1);
  assert.equal(action_queue[0].company, 'Quartzline');
  assert.equal(action_queue[0].overdue, 1);
});

test('dwell: median days held in each funnel stage', () => {
  const db = freshDb();
  seedFixture(db);
  const { dwell } = getHuntReport(db);
  const byStage = Object.fromEntries(dwell.map((d) => [d.stage, d]));
  assert.equal(byStage.Showings.median_days, 1);
  assert.equal(byStage.Showings.sample_count, 5);
  assert.equal(byStage.Staked.median_days, 2);
  assert.equal(byStage.Staked.sample_count, 4);
  assert.equal(byStage[PURGED_STAGE], undefined);
});

test('getHuntReport performs zero writes', () => {
  const db = freshDb();
  seedFixture(db);
  const before = rowCounts(db);
  getHuntReport(db);
  const after = rowCounts(db);
  assert.deepEqual(after, before);
});

test('apply_competition: rate/freshness buckets and Advanced-overrides-later-Tailings precedence', () => {
  const db = freshDb();
  seedFixture(db);
  const { apply_competition } = getHuntReport(db);
  assert.equal(apply_competition.raw.length, 5);

  const byCompany = Object.fromEntries(apply_competition.raw.map((r) => [r.company, r]));
  assert.equal(byCompany.Acme.outcome, 'Advanced');
  assert.equal(byCompany.Basalt.outcome, 'Rejected');
  assert.equal(byCompany.Quartzline.outcome, 'Advanced');
  assert.equal(byCompany.Diorite.outcome, 'Pending');
  assert.equal(byCompany.Feldspar.outcome, 'Advanced');
});

test('ghost_curves: staked_response survival steps and median, including a right-censored claim', () => {
  const db = freshDb();
  seedFixture(db);
  const { ghost_curves } = getHuntReport(db);
  const { steps, median, n } = ghost_curves.staked_response;
  assert.equal(n, 5);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].t, 1);
  closeTo(steps[0].survival, 1 - 1 / 5);
  assert.equal(steps[1].t, 2);
  closeTo(steps[1].survival, (1 - 1 / 5) * (1 - 3 / 4));
  assert.equal(steps[2].censored, 1);
  assert.equal(steps[2].events, 0);
  closeTo(steps[2].survival, (1 - 1 / 5) * (1 - 3 / 4));
  assert.equal(median, 2);
});

test('ghost_curves: interview_resolution survival steps and median for active interviews', () => {
  const db = freshDb();
  seedFixture(db);
  const { ghost_curves } = getHuntReport(db);
  const { steps, median, n } = ghost_curves.interview_resolution;
  assert.equal(n, 3);
  assert.ok(steps.length >= 1);
  assert.equal(ghost_curves[PURGED_STAGE_LOWER + '_resolution'], undefined, 'purged resolution key must be absent');
});

test('ghost_curves: empty when no claim has ever been staked', () => {
  const db = freshDb();
  const { ghost_curves } = getHuntReport(db);
  assert.deepEqual(ghost_curves.staked_response, { steps: [], median: null, n: 0 });
  assert.deepEqual(ghost_curves.interview_resolution, { steps: [], median: null, n: 0 });
});

test('renderHuntReportHtml: renders Hunt Report without throwing and contains no script tags', () => {
  const db = freshDb();
  seedFixture(db);
  const html = renderHuntReportHtml(getHuntReport(db));
  assert.equal((html.match(/<script(?! src="\/pwa-register\.js")/g) || []).length, 0);
  assert.match(html, /Hunt Report/);
  assert.match(html, /Ghost &amp; Resolution Curves/);
  assert.match(html, /Interview resolution/);
});

test('STAGES constant rejects purged stage', () => {
  assert.equal(STAGES.includes(PURGED_STAGE), false, 'STAGES array must not contain purged stage');
  assert.deepEqual(STAGES, ['Showings', 'Staked', 'Working the Vein', 'Strike', 'Tailings']);
});

test('ghost candidate advisory prompt moves to Staked stage', () => {
  const staleStakedClaim = { stage: 'Staked', stage_entered_at: daysAgo(15) + ' 09:00:00' };
  assert.equal(isGhostCandidate(staleStakedClaim), true, '14+ day old Staked claim should be ghost candidate');

  const freshStakedClaim = { stage: 'Staked', stage_entered_at: daysAgo(5) + ' 09:00:00' };
  assert.equal(isGhostCandidate(freshStakedClaim), false, 'Fresh Staked claim is not ghost candidate');

  const oldPurgedClaim = { stage: PURGED_STAGE, stage_entered_at: daysAgo(20) + ' 09:00:00' };
  assert.equal(isGhostCandidate(oldPurgedClaim), false, 'Purged stage claim is never ghost candidate');
});

test('response vs advancement distinction: rejection is a response but not advancement', () => {
  const db = freshDb();
  const rejectionClaim = seedClaim(db, { company: 'RejCo', role: 'Dev', stage: 'Tailings', appliedAt: '2026-07-01 09:00:00' });
  addTransition(db, rejectionClaim, null, 'Showings', '2026-07-01 08:00:00');
  addTransition(db, rejectionClaim, 'Showings', 'Staked', '2026-07-01 09:00:00');
  addTransition(db, rejectionClaim, 'Staked', 'Tailings', '2026-07-05 09:00:00', 'rejected');

  const report = getHuntReport(db);
  assert.equal(report.tally.response_rate.n_responded, 1, 'Rejection counts as response');
  assert.equal(report.apply_competition.raw[0].outcome, 'Rejected', 'Rejection outcome is Rejected, not Advanced');
});

test('vendor observations are orthogonal and do not mutate claim stage', () => {
  const db = freshDb();
  const claimId = seedClaim(db, { company: 'VendorCo', role: 'Dev', stage: 'Staked' });
  recordObservation(db, claimId, { statusText: 'In Review', vendor: 'Workday', source: 'test' });

  const claim = db.prepare('SELECT stage FROM claims WHERE id = ?').get(claimId);
  assert.equal(claim.stage, 'Staked', 'Claim stage must remain Staked after vendor observation');
});
