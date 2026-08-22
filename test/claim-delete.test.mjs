import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { deleteClaimById, ClaimDeleteError } from '../server/deleteClaim.js';
import { loadVecExtension } from '../server/vecExtension.js';
import { migrationHeadVersion } from './helpers/schemaVersion.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readSchema();

function readSchema() {
  return fs.readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');
}

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function tmpBackupDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-delete-test-'));
}

// Seeds a listing + claim, mirroring POST /api/claims' shape closely enough for FK purposes.
function seedListing(db, { company = 'Acme Corp', role = 'Engineer' } = {}) {
  const info = db.prepare(`INSERT INTO listings (source, company, role) VALUES ('Manual', ?, ?)`).run(company, role);
  return info.lastInsertRowid;
}

function seedClaim(db, listingId) {
  const info = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, 'Showings')`).run(listingId);
  const claimId = info.lastInsertRowid;
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, note, transition_cause)
    VALUES (?, NULL, 'Showings', 'staked', 'stake')
  `).run(claimId);
  return claimId;
}

test('deleteClaimById: 404s on a missing claim id, no backup written', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  assert.throws(
    () => deleteClaimById(db, 999999, backupDir),
    (err) => err instanceof ClaimDeleteError && err.status === 404,
  );
  assert.deepEqual(fs.readdirSync(backupDir), []);
});

test('deleteClaimById: cascades notes/transitions/contacts/events/resume_version_sends, deletes the claim, backs up first', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimId = seedClaim(db, listingId);
  db.prepare(`INSERT INTO claim_notes (claim_id, body) VALUES (?, ?)`).run(claimId, 'a note');
  db.prepare(`INSERT INTO contacts (claim_id, name) VALUES (?, ?)`).run(claimId, 'Jane Recruiter');
  db.prepare(`INSERT INTO listing_skills (listing_id, skill, tier) VALUES (?, ?, ?)`).run(listingId, 'SQL', 'core');
  db.prepare(`INSERT INTO listing_advisories (listing_id, desc_hash, model, advisory) VALUES (?, ?, ?, ?)`)
    .run(listingId, 'deadbeef', 'gpt-oss:20b', JSON.stringify({ comp_assessment: null, seniority_assessment: null, repost_assessment: null, questions: [] }));
  db.prepare(`INSERT INTO claim_events (claim_id, kind) VALUES (?, ?)`).run(claimId, 'recruiter_contact');
  const rv = db.prepare(`INSERT INTO resume_versions (label) VALUES ('v1')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO resume_version_sends (claim_id, resume_version_id) VALUES (?, ?)`).run(claimId, rv);
  db.prepare(`INSERT INTO job_listing_audits
    (listing_id, claim_id, listing_desc_hash, career_source_path, career_claims_hash,
     prompt_version, input_hash, status, deterministic_json)
    VALUES (?, ?, 'desc', '/claims.md', ?, 'v1', 'input', 'complete', '{}')`)
    .run(listingId, claimId, 'a'.repeat(64));

  const result = deleteClaimById(db, claimId, backupDir);

  assert.equal(result.deleted, true);
  assert.equal(result.listing_deleted, true);
  assert.ok(fs.existsSync(result.backup_path));

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM claims WHERE id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM claim_notes WHERE claim_id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM stage_transitions WHERE claim_id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM contacts WHERE claim_id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM claim_events WHERE claim_id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM resume_version_sends WHERE claim_id = ?').get(claimId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM listing_advisories WHERE listing_id = ?').get(listingId).c, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM job_listing_audits WHERE claim_id = ?').get(claimId).c, 0);

  const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
  assert.equal(backup.claim.id, claimId);
  assert.equal(backup.claim_notes.length, 1);
  assert.equal(backup.stage_transitions.length, 1);
  assert.equal(backup.contacts.length, 1);
  assert.equal(backup.claim_events.length, 1);
  assert.equal(backup.resume_version_sends.length, 1);
  assert.equal(backup.listing.id, listingId);
  assert.equal(backup.listing_skills.length, 1);
  assert.equal(backup.listing_advisories.length, 1);
  assert.equal(backup.job_listing_audits.length, 1);
});

test('deleteClaimById: preserves the listing when another claim still references it', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimA = seedClaim(db, listingId);
  seedClaim(db, listingId); // claimB, shares the same listing

  const result = deleteClaimById(db, claimA, backupDir);

  assert.equal(result.listing_deleted, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM listings WHERE id = ?').get(listingId).c, 1);
});

test('deleteClaimById: preserves the listing when a repost still points at it', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimId = seedClaim(db, listingId);
  const repostListingId = seedListing(db, { role: 'Engineer II' });
  db.prepare('UPDATE listings SET repost_of = ? WHERE id = ?').run(listingId, repostListingId);

  const result = deleteClaimById(db, claimId, backupDir);

  assert.equal(result.listing_deleted, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM listings WHERE id = ?').get(listingId).c, 1);
});

test('deleteClaimById: deletes the listing when it is the sole claim on a unique listing', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimId = seedClaim(db, listingId);

  const result = deleteClaimById(db, claimId, backupDir);

  assert.equal(result.listing_deleted, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM listings WHERE id = ?').get(listingId).c, 0);
});

test('deleteClaimById: PRAGMA foreign_key_check is clean after delete', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimId = seedClaim(db, listingId);
  db.prepare(`INSERT INTO claim_notes (claim_id, body) VALUES (?, ?)`).run(claimId, 'a note');
  db.prepare(`INSERT INTO contacts (claim_id, name) VALUES (?, ?)`).run(claimId, 'Jane Recruiter');
  db.prepare(`INSERT INTO listing_advisories (listing_id, desc_hash, model, advisory) VALUES (?, ?, ?, ?)`)
    .run(listingId, 'deadbeef', 'gpt-oss:20b', JSON.stringify({ comp_assessment: null, seniority_assessment: null, repost_assessment: null, questions: [] }));
  const rv = db.prepare(`INSERT INTO resume_versions (label) VALUES ('v1')`).run().lastInsertRowid;
  db.prepare(`INSERT INTO resume_version_sends (claim_id, resume_version_id) VALUES (?, ?)`).run(claimId, rv);

  deleteClaimById(db, claimId, backupDir);

  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('deleteClaimById: unlinks a captured Scout discovery before deleting its claim', () => {
  const db = freshDb();
  const backupDir = tmpBackupDir();
  const listingId = seedListing(db);
  const claimId = seedClaim(db, listingId);
  const profileId = db.prepare(`
    INSERT INTO scout_profile_versions (label, profile_json, profile_hash)
    VALUES ('test', '{}', 'profile-hash')
  `).run().lastInsertRowid;
  db.prepare(`
    INSERT INTO scout_discoveries (
      source, source_key, source_url, role, status, profile_version_id,
      fit_score, fit_label, assessment_json, linked_claim_id
    ) VALUES ('linkedin-alert', 'job:42', 'https://linkedin.com/jobs/view/42/',
      'Desktop Support Technician', 'captured', ?, 80, 'strong', '{}', ?)
  `).run(profileId, claimId);

  deleteClaimById(db, claimId, backupDir);

  assert.deepEqual(
    db.prepare('SELECT status, linked_claim_id FROM scout_discoveries WHERE source_key=?').get('job:42'),
    { status: 'new', linked_claim_id: null },
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('schema.sql: no ON DELETE CASCADE was added, and its head matches the migration chain', () => {
  assert.ok(!/ON DELETE/i.test(schemaSql), 'delete cascade is code-side, not a schema-side ON DELETE clause');
  const db = freshDb();
  assert.equal(db.pragma('user_version', { simple: true }), migrationHeadVersion());
});
