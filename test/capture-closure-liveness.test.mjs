// A captured snapshot that says the employer has stopped accepting applications becomes a §3.5b
// observation, and therefore a §6.3 liveness verdict.
//
// This came out of a real capture on 2026-08-09: claim #18 was staked from a LinkedIn posting whose
// page read "No longer accepting applications". The banner was sitting in the stored snapshot, and
// Prospect had no idea — the claim landed in Showings looking perfectly alive.
//
// The chain under test is deliberately made of parts that already existed. The adapter reads the
// employer's own words out of markup Prospect already holds (no crawler, DL-P8), the server records
// them through the same §3.5b path a manually-entered portal status uses, and liveness reaches
// closed_by_vendor on its own. Nothing here writes claims.stage: what the employer displays is not
// David's stage, which is §3.5b's founding invariant.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  normalizeVendorStatus, recordObservation, computeVendorStatus, isTerminalVendorStatus,
} from '../server/vendorStatus.js';
import { computeLiveness } from '../server/liveness.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db, { company = 'Scorpion', stage = 'Showings' } = {}) {
  const listingId = db.prepare(
    "INSERT INTO listings (source, company, role) VALUES ('LinkedIn', ?, 'IT Support Specialist')"
  ).run(company).lastInsertRowid;
  return db.prepare('INSERT INTO claims (listing_id, stage) VALUES (?, ?)').run(listingId, stage).lastInsertRowid;
}

test('the exact LinkedIn closure banner normalizes to closed', () => {
  // The literal string from the live posting, not a paraphrase.
  const result = normalizeVendorStatus('No longer accepting applications');
  assert.equal(result.status, 'closed');
  assert.equal(result.matched_phrase, 'no longer accepting applications');
});

test('sibling closure phrasings all reach a terminal status', () => {
  assert.equal(normalizeVendorStatus('Applications are closed').status, 'closed');
  // This one lands on 'expired' rather than 'closed', via the pre-existing 'no longer available'
  // rule. That is fine and is why no duplicate phrase was added for it: both are terminal, so
  // liveness treats them identically, and the finer label is the employer's own flavour of dead.
  assert.equal(normalizeVendorStatus('This job is no longer available').status, 'expired');
  for (const text of ['No longer accepting applications', 'Applications are closed', 'This job is no longer available']) {
    assert.equal(isTerminalVendorStatus(normalizeVendorStatus(text).status), true, text);
  }
});

test('an observation from a snapshot never touches the claim stage', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Showings' });
    recordObservation(db, claimId, {
      statusText: 'No longer accepting applications',
      note: 'observed in the captured snapshot',
    });
    assert.equal(db.prepare('SELECT stage FROM claims WHERE id = ?').pluck().get(claimId), 'Showings',
      'what the employer displays is not David stage');
    const [observed] = computeVendorStatus(db).claims;
    assert.equal(observed.latest_normalized, 'closed');
    assert.equal(observed.latest_status_text, 'No longer accepting applications', 'stored verbatim');
    assert.equal(observed.diverges, true, 'employer says closed while the claim is still active');
  } finally { db.close(); }
});

test('the claim stops looking alive: liveness reaches closed_by_vendor', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Showings' });

    // Before: nothing observed, so liveness honestly reports it cannot tell.
    const before = computeLiveness(db).claims.find((c) => c.claim_id === claimId);
    assert.equal(before.verdict, 'unobservable');
    assert.equal(before.residue, true);

    recordObservation(db, claimId, { statusText: 'No longer accepting applications' });

    const after = computeLiveness(db).claims.find((c) => c.claim_id === claimId);
    assert.equal(after.verdict, 'closed_by_vendor');
    assert.equal(after.live, false);
    assert.equal(after.residue, false, 'it leaves the §6.7.3 residue set — no judgment needed');
    assert.equal(after.evidence.vendor_status, 'closed');
    assert.equal(after.evidence.vendor_status_text, 'No longer accepting applications');
  } finally { db.close(); }
});

test('an open posting produces no observation and no verdict', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    // Nothing recorded, because the adapter found no banner.
    assert.equal(computeVendorStatus(db).totals.observations, 0);
    const claim = computeLiveness(db).claims.find((c) => c.claim_id === claimId);
    assert.equal(claim.verdict, 'unobservable', 'absence of a banner is not evidence of death');
  } finally { db.close(); }
});

test("David's own record still outranks the employer's banner", () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Tailings' });
    recordObservation(db, claimId, { statusText: 'No longer accepting applications' });
    const claim = computeLiveness(db).claims.find((c) => c.claim_id === claimId);
    assert.equal(claim.verdict, 'closed_by_record');
  } finally { db.close(); }
});
