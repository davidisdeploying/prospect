// §6.5 — The Prospector's Almanac and multi-hunt archives.
//
// The assertion this file is really about: a retrospective that reports a rate over four
// applications is worse than one that says "too few to say", because the point of a retrospective
// is to still be believable a year later.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  computeAlmanac,
  renderAlmanacHtml,
  MIN_RATE_N,
  MIN_EFFORT_OUTCOME_N,
  HUNT_STATUSES,
} from '../server/almanac.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addHunt(db, { name = 'Hunt One', status = 'active', startedAt = '2026-06-01 09:00:00', endedAt = null } = {}) {
  return db.prepare(`
    INSERT INTO hunts (name, status, started_at, ended_at) VALUES (?, ?, ?, ?)
  `).run(name, status, startedAt, endedAt).lastInsertRowid;
}

function addClaim(db, { huntId = null, stage = 'Staked', company = 'Acme', minutes = null, comp = null, createdAt = '2026-06-02 09:00:00', outcomeReason = null } = {}) {
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role, comp_disclosed, annual_comp_mid)
    VALUES ('test', ?, 'Support Engineer', ?, ?)
  `).run(company, comp == null ? null : 1, comp).lastInsertRowid;
  return db.prepare(`
    INSERT INTO claims (listing_id, hunt_id, stage, application_minutes, created_at, applied_at, outcome_reason)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(listingId, huntId, stage, minutes, createdAt, createdAt, outcomeReason).lastInsertRowid;
}

function addTransition(db, claimId, toStage, at) {
  db.prepare("INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at) VALUES (?, 'Staked', ?, ?)")
    .run(claimId, toStage, at);
}

test('a thin hunt reports counts but refuses to state a rate', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    for (let i = 0; i < 3; i += 1) addClaim(db, { huntId, company: `Co ${i}` });
    const [summary] = computeAlmanac(db).hunts;
    assert.equal(summary.totals.claims, 3);
    assert.equal(summary.rates.response.sufficient, false);
    assert.equal(summary.rates.response.value, null, 'no percentage from three applications');
    assert.equal(summary.rates.response.n, 3, 'but the count is still visible');
    assert.equal(summary.rates.response.min_n, MIN_RATE_N);
  } finally { db.close(); }
});

test('a sufficient hunt states the rate', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    const ids = [];
    for (let i = 0; i < 6; i += 1) ids.push(addClaim(db, { huntId, company: `Co ${i}` }));
    addTransition(db, ids[0], 'Working the Vein', '2026-06-10 09:00:00');
    addTransition(db, ids[1], 'Working the Vein', '2026-06-12 09:00:00');

    const [summary] = computeAlmanac(db).hunts;
    assert.equal(summary.rates.response.sufficient, true);
    assert.ok(Math.abs(summary.rates.response.value - 33.33) < 0.1);
    assert.equal(summary.rates.response.n, 6);
  } finally { db.close(); }
});

test('the deepest stage ever reached survives a claim later dying', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    const claimId = addClaim(db, { huntId, stage: 'Tailings', outcomeReason: 'rejected' });
    addTransition(db, claimId, 'Working the Vein', '2026-06-10 09:00:00');

    const [summary] = computeAlmanac(db).hunts;
    const vein = summary.funnel.find((f) => f.stage === 'Working the Vein');
    assert.equal(vein.ever_reached, 1, 'it did reach Working the Vein, and the retrospective must not forget');
    assert.equal(summary.totals.tailings, 1);
    assert.deepEqual(summary.outcome_reasons, [{ reason: 'rejected', count: 1 }]);
  } finally { db.close(); }
});

test('effort and comp are summarized only over the claims that recorded them', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    addClaim(db, { huntId, minutes: 90, comp: 70000, company: 'A' });
    addClaim(db, { huntId, minutes: 30, comp: 80000, company: 'B' });
    addClaim(db, { huntId, minutes: null, comp: null, company: 'C' });

    const [summary] = computeAlmanac(db).hunts;
    assert.equal(summary.effort.claims_with_time, 2, 'unrecorded time is not counted as zero');
    assert.equal(summary.effort.total_minutes, 120);
    assert.equal(summary.effort.median_minutes, 60);
    assert.equal(summary.comp.n, 2);
    assert.equal(summary.comp.median, 75000);
  } finally { db.close(); }
});

test('effort by outcome excludes active claims and gates thin decided groups', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    addClaim(db, { huntId, stage: 'Staked', minutes: 75, company: 'Active with time' });
    addClaim(db, { huntId, stage: 'Showings', minutes: null, company: 'Active without time' });
    addClaim(db, { huntId, stage: 'Tailings', minutes: 30, company: 'Rejected' });
    addClaim(db, { huntId, stage: 'Tailings', minutes: null, company: 'Rejected unknown effort' });
    addClaim(db, { huntId, stage: 'Strike', minutes: 120, company: 'Offer' });

    const breakdown = computeAlmanac(db).hunts[0].effort_by_outcome;
    assert.equal(breakdown.min_n, MIN_EFFORT_OUTCOME_N);
    assert.equal(breakdown.censored_claims, 2, 'active claims are censored, not called outcomes');
    assert.equal(breakdown.censored_with_time, 1);
    assert.deepEqual(breakdown.outcomes, [
      {
        outcome: 'Tailings', claims: 2, claims_with_time: 1, sufficient: false,
        min_n: MIN_EFFORT_OUTCOME_N, total_minutes: null, median_minutes: null,
      },
      {
        outcome: 'Strike', claims: 1, claims_with_time: 1, sufficient: false,
        min_n: MIN_EFFORT_OUTCOME_N, total_minutes: null, median_minutes: null,
      },
    ]);
  } finally { db.close(); }
});

test('effort by outcome reports medians only when each outcome reaches the gate', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    for (const minutes of [10, 20, 30, 40, 50]) {
      addClaim(db, { huntId, stage: 'Tailings', minutes, company: `Tailings ${minutes}` });
    }
    for (const minutes of [60, 80, 100, 120, 140]) {
      addClaim(db, { huntId, stage: 'Strike', minutes, company: `Strike ${minutes}` });
    }

    const [tailings, strike] = computeAlmanac(db).hunts[0].effort_by_outcome.outcomes;
    assert.deepEqual(
      { sufficient: tailings.sufficient, total: tailings.total_minutes, median: tailings.median_minutes },
      { sufficient: true, total: 150, median: 30 },
    );
    assert.deepEqual(
      { sufficient: strike.sufficient, total: strike.total_minutes, median: strike.median_minutes },
      { sufficient: true, total: 500, median: 100 },
    );
  } finally { db.close(); }
});

test('computing the almanac performs no database writes', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    addClaim(db, { huntId, stage: 'Tailings', minutes: 45 });
    const before = db.totalChanges;
    computeAlmanac(db);
    assert.equal(db.totalChanges, before);
  } finally { db.close(); }
});

test('claims with no hunt are named Unassigned rather than folded into the first hunt', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db, { name: 'Real Hunt' });
    addClaim(db, { huntId, company: 'In Hunt' });
    addClaim(db, { huntId: null, company: 'Orphan' });

    const almanac = computeAlmanac(db);
    const names = almanac.hunts.map((h) => h.hunt.name);
    assert.deepEqual(names, ['Real Hunt', 'Unassigned']);
    assert.equal(almanac.hunts[0].totals.claims, 1);
    assert.equal(almanac.hunts[1].totals.claims, 1);
  } finally { db.close(); }
});

test('no Unassigned section appears when every claim has a hunt', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    addClaim(db, { huntId });
    assert.deepEqual(computeAlmanac(db).hunts.map((h) => h.hunt.name), ['Hunt One']);
  } finally { db.close(); }
});

test('hunt-over-hunt comparison appears only with more than one hunt', () => {
  const db = freshDb();
  try {
    const first = addHunt(db, { name: 'Hunt One', status: 'closed', startedAt: '2026-01-01 09:00:00', endedAt: '2026-03-01 09:00:00' });
    addClaim(db, { huntId: first });
    assert.deepEqual(computeAlmanac(db).comparison, []);

    const second = addHunt(db, { name: 'Hunt Two', startedAt: '2026-06-01 09:00:00' });
    addClaim(db, { huntId: second });
    const comparison = computeAlmanac(db).comparison;
    assert.equal(comparison.length, 2);
    assert.deepEqual(comparison.map((c) => c.hunt), ['Hunt One', 'Hunt Two']);
  } finally { db.close(); }
});

test('a closed hunt reports its real duration', () => {
  const db = freshDb();
  try {
    addHunt(db, { name: 'Closed', status: 'closed', startedAt: '2026-01-01 00:00:00', endedAt: '2026-03-02 00:00:00' });
    const [summary] = computeAlmanac(db).hunts;
    assert.equal(summary.hunt.duration_days, 60);
    assert.equal(summary.hunt.status, 'closed');
  } finally { db.close(); }
});

test('the almanac renders JS-free and shows thin samples as thin', () => {
  const db = freshDb();
  try {
    const huntId = addHunt(db);
    addClaim(db, { huntId });
    const html = renderAlmanacHtml(computeAlmanac(db));
    const body = html.slice(html.indexOf('<body>'));
    assert.equal(/<script(?![^>]*src="\/pwa-register\.js")/.test(body), false);
    assert.ok(html.includes("The Prospector's Almanac"));
    assert.ok(html.includes('too few to say (n=1)'), 'a thin rate reads as thin, not as a number');
    assert.ok(html.includes('Effort by decided outcome'));
    assert.ok(html.includes(`too few to compare (n=0; need ${MIN_EFFORT_OUTCOME_N})`));
    assert.ok(html.includes('1 active claim remains censored (0 with recorded time)'));
  } finally { db.close(); }
});

test('hunt status vocabulary is stable', () => {
  assert.deepEqual(HUNT_STATUSES, ['active', 'closed', 'paused', 'abandoned']);
});
