import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { computeAlmanac } from '../server/almanac.js';
import { getHuntReport } from '../server/huntReport.js';
import { computeTally } from '../server/tally.js';
import { loadVecExtension } from '../server/vecExtension.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addClaim(db, company, stage = 'Staked') {
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role) VALUES ('test', ?, 'Engineer')
  `).run(company).lastInsertRowid;
  return db.prepare(`
    INSERT INTO claims (listing_id, stage, created_at, applied_at, stage_entered_at)
    VALUES (?, ?, '2026-01-01 09:00:00', '2026-01-01 09:00:00', '2026-01-01 09:00:00')
  `).run(listingId, stage).lastInsertRowid;
}

function addTransition(db, claimId, fromStage, toStage, at, outcomeReason = null) {
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause, outcome_reason)
    VALUES (?, ?, ?, ?, 'manual', ?)
  `).run(claimId, fromStage, toStage, at, outcomeReason);
}

test('response is every exit from Staked while only Working the Vein and Strike advance', () => {
  const db = freshDb();
  try {
    const rejected = addClaim(db, 'Rejected', 'Tailings');
    const returned = addClaim(db, 'Returned', 'Showings');
    const pending = [addClaim(db, 'Pending 1'), addClaim(db, 'Pending 2'), addClaim(db, 'Pending 3')];
    for (const claimId of [rejected, returned, ...pending]) {
      addTransition(db, claimId, null, 'Showings', '2026-01-01 08:00:00');
      addTransition(db, claimId, 'Showings', 'Staked', '2026-01-01 09:00:00');
    }
    addTransition(db, rejected, 'Staked', 'Tailings', '2026-01-03 09:00:00', 'rejected');
    addTransition(db, returned, 'Staked', 'Showings', '2026-01-05 09:00:00');

    const tally = computeTally(db, { now: '2026-01-06 09:00:00' });
    assert.deepEqual(tally.response_rate, { n_staked: 5, n_responded: 2, rate: 0.4 });

    const report = getHuntReport(db);
    assert.deepEqual(report.response_latency, { sample_count: 2, median_days: 3 });
    assert.equal(report.funnel.find((row) => row.stage === 'Working the Vein').count, 0);
    assert.equal(report.funnel.find((row) => row.stage === 'Strike').count, 0);

    const [almanac] = computeAlmanac(db).hunts;
    assert.equal(almanac.rates.response.value, 40);
    assert.equal(almanac.response_time.n, 2);
    assert.equal(almanac.response_time.median_days, 3);
    assert.equal(almanac.funnel.find((row) => row.stage === 'Working the Vein').ever_reached, 0);
    assert.equal(almanac.funnel.find((row) => row.stage === 'Strike').ever_reached, 0);
  } finally { db.close(); }
});
