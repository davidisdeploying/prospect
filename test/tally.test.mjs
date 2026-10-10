import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { computeTally } from '../server/tally.js';
import { getHuntReport, renderHuntReportHtml } from '../server/huntReport.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function insertListing(db, { company = 'Co', role = 'Role', easyApply = null } = {}) {
  const info = db.prepare(`
    INSERT INTO listings (source, company, role, easy_apply) VALUES ('Manual', ?, ?, ?)
  `).run(company, role, easyApply);
  return info.lastInsertRowid;
}

function insertClaim(db, { listingId, appliedAt = null, applicationMinutes = null, stage = 'Staked' } = {}) {
  const info = db.prepare(`
    INSERT INTO claims (listing_id, stage, stage_entered_at, applied_at, application_minutes)
    VALUES (?, ?, ?, ?, ?)
  `).run(listingId, stage, appliedAt, appliedAt, applicationMinutes);
  return info.lastInsertRowid;
}

function insertStake(db, { company, role, appliedAt, applicationMinutes = null, easyApply = null }) {
  const listingId = insertListing(db, { company, role, easyApply });
  return insertClaim(db, { listingId, appliedAt, applicationMinutes });
}

function insertTransition(db, claimId, fromStage, toStage, transitionedAt, outcomeReason = null) {
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause, outcome_reason)
    VALUES (?, ?, ?, ?, 'manual', ?)
  `).run(claimId, fromStage, toStage, transitionedAt, outcomeReason);
}

function rowCounts(db) {
  return {
    claims: db.prepare('SELECT count(*) AS n FROM claims').get().n,
    listings: db.prepare('SELECT count(*) AS n FROM listings').get().n,
    stage_transitions: db.prepare('SELECT count(*) AS n FROM stage_transitions').get().n,
  };
}

function heatmapCell(tally, date) {
  return tally.heatmap.weeks.flat().find((d) => d.date === date);
}

// --- streaks ---------------------------------------------------------------

test('streak: a 3-day run, a gap, then a 2-day run ending today', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-10 15:00:00' });
  insertStake(db, { company: 'B', role: 'X', appliedAt: '2026-07-11 15:00:00' });
  insertStake(db, { company: 'C', role: 'X', appliedAt: '2026-07-12 15:00:00' });
  // gap on 07-13
  insertStake(db, { company: 'D', role: 'X', appliedAt: '2026-07-14 15:00:00' });
  insertStake(db, { company: 'E', role: 'X', appliedAt: '2026-07-15 15:00:00' });

  const tally = computeTally(db, { now: '2026-07-15 20:00:00' }); // Chicago day 2026-07-15 (CDT)
  assert.equal(tally.current_streak, 2);
  assert.equal(tally.longest_streak, 3);
  assert.equal(tally.active_days, 5);
});

test('streak: no stake today gives current_streak 0 but preserves the historical longest_streak', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-10 15:00:00' });
  insertStake(db, { company: 'B', role: 'X', appliedAt: '2026-07-11 15:00:00' });
  insertStake(db, { company: 'C', role: 'X', appliedAt: '2026-07-12 15:00:00' });

  const tally = computeTally(db, { now: '2026-07-16 20:00:00' }); // Chicago day 2026-07-16, no stake
  assert.equal(tally.current_streak, 0);
  assert.equal(tally.longest_streak, 3);
});

// --- TZ boundary (the motivating bug) ---------------------------------------

test('chicagoDay boundary: a 04:30 UTC stake buckets to the PRIOR Chicago day, not the UTC day', () => {
  const db = freshDb();
  insertStake(db, { company: 'Acme', role: 'X', appliedAt: '2026-07-18 04:30:00' });

  const tally = computeTally(db, { now: '2026-07-18 15:00:00' }); // Chicago day 2026-07-18 (CDT, UTC-5)
  assert.equal(heatmapCell(tally, '2026-07-17').count, 1);
  assert.equal(heatmapCell(tally, '2026-07-18').count, 0);
  assert.equal(tally.active_days, 1);
  assert.equal(tally.current_streak, 0); // today (07-18) itself has no stake
});

test('chicagoDay DST-side check: January (CST, UTC-6) and July (CDT, UTC-5) both bucket correctly', () => {
  const dbJuly = freshDb();
  insertStake(dbJuly, { company: 'JulyCo', role: 'X', appliedAt: '2026-07-10 04:30:00' });
  const julyTally = computeTally(dbJuly, { now: '2026-07-10 15:00:00' });
  assert.equal(heatmapCell(julyTally, '2026-07-09').count, 1);
  assert.equal(heatmapCell(julyTally, '2026-07-10').count, 0);

  const dbJan = freshDb();
  insertStake(dbJan, { company: 'JanCo', role: 'X', appliedAt: '2026-01-10 05:30:00' });
  const janTally = computeTally(dbJan, { now: '2026-01-10 15:00:00' });
  assert.equal(heatmapCell(janTally, '2026-01-09').count, 1);
  assert.equal(heatmapCell(janTally, '2026-01-10').count, 0);
});

// --- counts ------------------------------------------------------------------

test('staked_total / staked_this_week / staked_this_month on a multi-day, multi-month fixture', () => {
  const db = freshDb();
  insertStake(db, { company: 'PriorMonth', role: 'X', appliedAt: '2026-06-29 15:00:00' }); // prior month
  insertStake(db, { company: 'PriorWeek', role: 'X', appliedAt: '2026-07-05 15:00:00' }); // prior week
  insertStake(db, { company: 'ThisWeekA', role: 'X', appliedAt: '2026-07-12 15:00:00' }); // this week (Sun)
  insertStake(db, { company: 'ThisWeekB', role: 'X', appliedAt: '2026-07-12 16:00:00' }); // this week (Sun), 2nd stake same day
  insertStake(db, { company: 'ThisWeekC', role: 'X', appliedAt: '2026-07-14 15:00:00' }); // this week (Tue)

  const tally = computeTally(db, { now: '2026-07-15 20:00:00' }); // Chicago day 2026-07-15 (Wed), week = Sun 07-12..Sat 07-18
  assert.equal(tally.staked_total, 5);
  assert.equal(tally.staked_this_week, 3);
  assert.equal(tally.staked_this_month, 4);
});

// --- response_rate / ghost_rate ---------------------------------------------

test('response_rate and ghost_rate, including a reopen where the LATEST Tailings outcome wins', () => {
  const db = freshDb();

  // A: Staked -> Working the Vein (responded, not a ghost)
  const listingA = insertListing(db);
  const a = insertClaim(db, { listingId: listingA, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, a, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, a, 'Showings', 'Staked', '2026-07-01 15:00:00');
  insertTransition(db, a, 'Staked', 'Working the Vein', '2026-07-03 15:00:00');

  // B: Staked -> Tailings, ghosted (responded via Tailings, and a ghost)
  const listingB = insertListing(db);
  const b = insertClaim(db, { listingId: listingB, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, b, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, b, 'Showings', 'Staked', '2026-07-01 15:00:00');
  insertTransition(db, b, 'Staked', 'Tailings', '2026-07-15 15:00:00', 'ghosted');

  // C: Staked only, never responded
  const listingC = insertListing(db);
  const c = insertClaim(db, { listingId: listingC, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, c, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, c, 'Showings', 'Staked', '2026-07-01 15:00:00');

  // D: Staked -> Tailings, rejected (responded, not ghosted)
  const listingD = insertListing(db);
  const d = insertClaim(db, { listingId: listingD, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, d, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, d, 'Showings', 'Staked', '2026-07-01 15:00:00');
  insertTransition(db, d, 'Staked', 'Tailings', '2026-07-05 15:00:00', 'rejected');

  // E: Staked -> Tailings (ghosted) -> reopened to Showings -> Staked -> Tailings (rejected).
  // The LATEST Tailings row (rejected) must win, not the earlier ghosted one.
  const listingE = insertListing(db);
  const e = insertClaim(db, { listingId: listingE, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, e, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, e, 'Showings', 'Staked', '2026-07-01 15:00:00');
  insertTransition(db, e, 'Staked', 'Tailings', '2026-07-04 15:00:00', 'ghosted');
  insertTransition(db, e, 'Tailings', 'Showings', '2026-07-06 15:00:00');
  insertTransition(db, e, 'Showings', 'Staked', '2026-07-07 15:00:00');
  insertTransition(db, e, 'Staked', 'Tailings', '2026-07-09 15:00:00', 'rejected');

  const tally = computeTally(db, { now: '2026-07-16 15:00:00' });
  assert.equal(tally.response_rate.n_staked, 5);
  assert.equal(tally.response_rate.n_responded, 4); // all but C
  assert.equal(tally.response_rate.rate, 0.8);

  assert.equal(tally.ghost_rate.n_tailings, 3); // B, D, E
  assert.equal(tally.ghost_rate.n_ghosted, 1); // only B — E's latest Tailings is 'rejected'
  assert.ok(Math.abs(tally.ghost_rate.rate - 1 / 3) < 1e-9);
});

// --- honest empty states -----------------------------------------------------

test('effort: sufficient=false when no claim has application_minutes logged', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-01 15:00:00' });
  const tally = computeTally(db, { now: '2026-07-01 20:00:00' });
  assert.equal(tally.effort.sufficient, false);
  assert.equal(tally.effort.n, 0);
});

test('easy_apply_share: sufficient=false when no staked claim has a known easy_apply flag', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-01 15:00:00' });
  const tally = computeTally(db, { now: '2026-07-01 20:00:00' });
  assert.equal(tally.easy_apply_share.sufficient, false);
  assert.equal(tally.easy_apply_share.n_known, 0);
});

test('effort and easy_apply_share: computed correctly once data is present', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-01 15:00:00', applicationMinutes: 10, easyApply: 1 });
  insertStake(db, { company: 'B', role: 'X', appliedAt: '2026-07-02 15:00:00', applicationMinutes: 20, easyApply: 0 });
  const tally = computeTally(db, { now: '2026-07-02 20:00:00' });
  assert.equal(tally.effort.sufficient, true);
  assert.equal(tally.effort.n, 2);
  assert.equal(tally.effort.sum_minutes, 30);
  assert.equal(tally.effort.avg_minutes, 15);
  assert.equal(tally.easy_apply_share.sufficient, true);
  assert.equal(tally.easy_apply_share.n_known, 2);
  assert.equal(tally.easy_apply_share.n_easy, 1);
  assert.equal(tally.easy_apply_share.rate, 0.5);
});

// --- zero-writes --------------------------------------------------------------

test('computeTally performs zero writes', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-01 15:00:00' });
  const before = rowCounts(db);
  computeTally(db, { now: '2026-07-01 20:00:00' });
  const after = rowCounts(db);
  assert.deepEqual(after, before);
});

// --- rendered report ------------------------------------------------------------

test('renderHuntReportHtml: The Tally is JS-free-legible, sits above the Funnel, and the heatmap is fully server-rendered', () => {
  const db = freshDb();
  insertStake(db, { company: 'A', role: 'X', appliedAt: '2026-07-01 15:00:00' });
  const report = getHuntReport(db);
  const html = renderHuntReportHtml(report);

  assert.equal((html.match(/<script(?! src="\/pwa-register\.js")/g) || []).length, 0);

  const tallyIdx = html.indexOf('<h2>The Tally</h2>');
  const funnelIdx = html.indexOf('>Funnel<');
  assert.ok(tallyIdx > -1 && funnelIdx > -1 && tallyIdx < funnelIdx);

  assert.match(html, new RegExp(`<span class="odo-real">${report.tally.staked_total}</span>`));

  const cellCount = (html.match(/class="tally-heat-cell"/g) || []).length;
  assert.equal(cellCount, 26 * 7 + 5); // 182 grid cells + 5 legend swatches

  const tallySectionHtml = html.slice(tallyIdx, funnelIdx);
  assert.doesNotMatch(tallySectionHtml, /#CDA349|placer-gold|value-gold|bar-gold|accent/);
});
