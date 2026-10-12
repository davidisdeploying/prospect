import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { recordResumeVersionSend } from '../server/resumeVersionSends.js';
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

function seedClaim(db) {
  const listing = db.prepare(`INSERT INTO listings (source, company, role) VALUES ('Manual', 'Acme', 'Engineer')`).run();
  const claim = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, 'Showings')`).run(listing.lastInsertRowid);
  return claim.lastInsertRowid;
}

function seedResumeVersion(db, label = 'v1') {
  return db.prepare(`INSERT INTO resume_versions (label) VALUES (?)`).run(label).lastInsertRowid;
}

test('recordResumeVersionSend: setting resume_version_id from null to a real value logs one send', () => {
  const db = freshDb();
  const claimId = seedClaim(db);
  const rv = seedResumeVersion(db);

  const sent = recordResumeVersionSend(db, claimId, null, rv);

  assert.ok(sent);
  assert.equal(sent.claim_id, claimId);
  assert.equal(sent.resume_version_id, rv);
  const rows = db.prepare('SELECT * FROM resume_version_sends WHERE claim_id = ?').all(claimId);
  assert.equal(rows.length, 1);
});

test('recordResumeVersionSend: re-patching the same value it already holds logs nothing', () => {
  const db = freshDb();
  const claimId = seedClaim(db);
  const rv = seedResumeVersion(db);

  recordResumeVersionSend(db, claimId, null, rv);
  const second = recordResumeVersionSend(db, claimId, rv, rv);

  assert.equal(second, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM resume_version_sends WHERE claim_id = ?').get(claimId).c, 1);
});

test('recordResumeVersionSend: clearing to null is not a send', () => {
  const db = freshDb();
  const claimId = seedClaim(db);
  const rv = seedResumeVersion(db);

  recordResumeVersionSend(db, claimId, null, rv);
  const cleared = recordResumeVersionSend(db, claimId, rv, null);

  assert.equal(cleared, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM resume_version_sends WHERE claim_id = ?').get(claimId).c, 1);
});

test('recordResumeVersionSend: swapping to a different version appends history instead of overwriting it', () => {
  const db = freshDb();
  const claimId = seedClaim(db);
  const rvA = seedResumeVersion(db, 'v1');
  const rvB = seedResumeVersion(db, 'v2');

  recordResumeVersionSend(db, claimId, null, rvA);
  recordResumeVersionSend(db, claimId, rvA, rvB);

  const rows = db.prepare('SELECT resume_version_id FROM resume_version_sends WHERE claim_id = ? ORDER BY id').all(claimId);
  assert.deepEqual(rows.map((r) => r.resume_version_id), [rvA, rvB]);
});

test('resume_version_sends: FK-constrained to a real resume_versions row', () => {
  const db = freshDb();
  const claimId = seedClaim(db);

  assert.throws(() => recordResumeVersionSend(db, claimId, null, 999999), /FOREIGN KEY constraint failed/);
});

test('schema.sql: resume_version_sends is append-only (no ON DELETE clause of its own, indexed by claim_id)', () => {
  const db = freshDb();
  const cols = db.prepare(`PRAGMA table_info(resume_version_sends)`).all().map((c) => c.name);
  assert.deepEqual(cols, ['id', 'claim_id', 'resume_version_id', 'sent_at']);
  const indexes = db.prepare(`PRAGMA index_list(resume_version_sends)`).all().map((i) => i.name);
  assert.ok(indexes.includes('idx_resume_version_sends_claim'));
});
