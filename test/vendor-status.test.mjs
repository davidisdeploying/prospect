// §3.5b — external vendor-status observations and the tracker adapters.
//
// The invariant under test throughout: employer-claimed status is never merged into David's stage,
// and an unrecognized phrase is never forced into the nearest bucket. Getting either wrong means
// silently declaring a live application dead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  detectVendor, normalizeVendorStatus, recordObservation, computeVendorStatus,
  isTerminalVendorStatus, TERMINAL_VENDOR_STATUSES,
} from '../server/vendorStatus.js';
import { computeLiveness } from '../server/liveness.js';
import { deleteClaimById } from '../server/deleteClaim.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db, { company = 'Amazon', stage = 'Staked', trackerUrl = null } = {}) {
  const listingId = db.prepare("INSERT INTO listings (source, company, role) VALUES ('test', ?, 'IT Support')")
    .run(company).lastInsertRowid;
  return db.prepare('INSERT INTO claims (listing_id, stage, vendor_tracker_url) VALUES (?, ?, ?)')
    .run(listingId, stage, trackerUrl).lastInsertRowid;
}

test('vendors are detected from the tracker host, and never guessed', () => {
  assert.equal(detectVendor('https://amazon.jobs/en/applications/123'), 'amazon');
  assert.equal(detectVendor('https://acme.wd1.myworkdayjobs.com/careers/x'), 'workday');
  assert.equal(detectVendor('https://boards.greenhouse.io/acme/jobs/1'), 'greenhouse');
  assert.equal(detectVendor('https://jobs.lever.co/acme/abc'), 'lever');
  assert.equal(detectVendor('https://some-unknown-ats.example.com/x'), null, 'an unknown host is null, not a guess');
  assert.equal(detectVendor(null), null);
  assert.equal(detectVendor('not a url'), null);
});

test('the phrase that killed an application silently is recognized', () => {
  // 2026-07-18: an older Amazon application showed "Assessment expired" in the employer's tracker
  // while Prospect's stage log showed nothing. That exact string is the motivating case.
  const result = normalizeVendorStatus('Assessment expired');
  assert.equal(result.status, 'expired');
  assert.equal(isTerminalVendorStatus('expired'), true);
});

test('unrecognized wording normalizes to null rather than the nearest bucket', () => {
  assert.equal(normalizeVendorStatus('Your candidacy is being socialized internally'), null);
  assert.equal(normalizeVendorStatus(''), null);
  assert.equal(normalizeVendorStatus(null), null);
});

test('normalization records provenance and keeps the employer wording verbatim', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { trackerUrl: 'https://amazon.jobs/applications/1' });
    const row = recordObservation(db, claimId, { statusText: '  No longer under consideration  ' });
    assert.equal(row.status_text, 'No longer under consideration', 'verbatim, only trimmed');
    assert.equal(row.normalized_status, 'rejected');
    assert.equal(row.normalized_by, 'phrase:amazon');
    assert.equal(row.vendor, 'amazon', 'vendor inferred from the claim tracker URL');
  } finally { db.close(); }
});

test('an observation never writes the claim stage', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Staked' });
    recordObservation(db, claimId, { statusText: 'No longer under consideration' });
    assert.equal(db.prepare('SELECT stage FROM claims WHERE id = ?').pluck().get(claimId), 'Staked',
      'employer-claimed status is not David stage and must never overwrite it');
  } finally { db.close(); }
});

test('divergence is reported, not resolved', () => {
  const db = freshDb();
  try {
    const diverging = seedClaim(db, { company: 'Diverge Co', stage: 'Staked' });
    recordObservation(db, diverging, { statusText: 'Position closed' });
    const agreeing = seedClaim(db, { company: 'Agree Co', stage: 'Tailings' });
    recordObservation(db, agreeing, { statusText: 'Not selected' });

    const result = computeVendorStatus(db);
    assert.equal(result.divergences.length, 1);
    assert.equal(result.divergences[0].company, 'Diverge Co');
    assert.equal(result.claims.find((c) => c.company === 'Agree Co').diverges, false,
      'employer and David agreeing is not a divergence');
  } finally { db.close(); }
});

test('observations are append-only and the sequence is preserved', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    recordObservation(db, claimId, { statusText: 'Application submitted', observedAt: '2026-07-01 09:00:00' });
    recordObservation(db, claimId, { statusText: 'Under review', observedAt: '2026-07-10 09:00:00' });
    recordObservation(db, claimId, { statusText: 'Not selected', observedAt: '2026-07-20 09:00:00' });

    const [claim] = computeVendorStatus(db).claims;
    assert.equal(claim.observations.length, 3, 'a new status does not replace the last one');
    assert.deepEqual(claim.observations.map((o) => o.normalized_status), ['submitted', 'in_review', 'rejected']);
    assert.equal(claim.latest_normalized, 'rejected');
  } finally { db.close(); }
});

test('unrecognized wording is counted so the phrase table can be seen falling behind', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    recordObservation(db, claimId, { statusText: 'Under review' });
    recordObservation(db, claimId, { statusText: 'Candidacy socialized internally' });
    const { totals } = computeVendorStatus(db);
    assert.equal(totals.observations, 2);
    assert.equal(totals.unrecognized, 1);
  } finally { db.close(); }
});

test('a terminal vendor status decides liveness, attributed to the employer not to David', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { company: 'Vendor Closed Co', stage: 'Staked' });
    recordObservation(db, claimId, { statusText: 'Assessment expired' });

    const liveness = computeLiveness(db);
    const [claim] = liveness.claims;
    assert.equal(claim.verdict, 'closed_by_vendor');
    assert.equal(claim.decided, true);
    assert.equal(claim.live, false);
    assert.equal(claim.residue, false, 'this claim leaves the §6.7.3 residue set');
    assert.equal(claim.evidence.vendor_status, 'expired');
    assert.equal(claim.evidence.vendor_status_text, 'Assessment expired');
  } finally { db.close(); }
});

test("David's own record outranks the employer's echo of it", () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Tailings' });
    recordObservation(db, claimId, { statusText: 'Not selected' });
    const [claim] = computeLiveness(db).claims;
    assert.equal(claim.verdict, 'closed_by_record', 'he closed it himself; the echo is not new information');
  } finally { db.close(); }
});

test('a non-terminal vendor status does not decide liveness', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { stage: 'Staked' });
    recordObservation(db, claimId, { statusText: 'Under review' });
    const [claim] = computeLiveness(db).claims;
    assert.equal(claim.verdict, 'unobservable', 'in-review says the application lives, not that the listing does');
    assert.equal(claim.residue, true);
  } finally { db.close(); }
});

test('hard delete cascades vendor observations', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-vendor-'));
  try {
    const claimId = seedClaim(db);
    recordObservation(db, claimId, { statusText: 'Under review' });
    const result = deleteClaimById(db, claimId, backupDir);
    assert.equal(db.prepare('SELECT COUNT(*) FROM vendor_status_observations').pluck().get(), 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
    assert.equal(backup.vendor_status_observations.length, 1);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('terminal vocabulary is stable', () => {
  assert.deepEqual(TERMINAL_VENDOR_STATUSES, ['rejected', 'withdrawn', 'closed', 'expired']);
});
