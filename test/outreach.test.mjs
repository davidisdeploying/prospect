// §6.6 — inbound outreach with no claim attached, and the origin edge when a thread converts.
//
// The exemplar this section exists for: a recruiter pitched a different Amazon role the same week
// as claim #1, with no application involved. The assertions below are mostly about what must NOT
// happen — no invented claim to hold a lead, and no rewritten history when a claim is deleted.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  computeOutreach, convertThreadToClaim, OutreachConvertError,
  OUTREACH_STATUSES, OUTREACH_DIRECTIONS,
} from '../server/outreach.js';
import { deleteClaimById } from '../server/deleteClaim.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addThread(db, fields = {}) {
  return db.prepare(`
    INSERT INTO outreach_threads (company_name, contact_name, contact_role, channel, role_pitched, status, first_contact_at)
    VALUES (@company_name, @contact_name, @contact_role, @channel, @role_pitched, @status, @first_contact_at)
  `).run({
    company_name: 'Amazon', contact_name: 'A Recruiter', contact_role: 'Technical Recruiter',
    channel: 'linkedin_dm', role_pitched: 'IT Support Associate II', status: 'open',
    first_contact_at: '2026-07-18 12:00:00',
    ...fields,
  }).lastInsertRowid;
}

function seedClaim(db, { company = 'Amazon', role = 'IT Support Associate II' } = {}) {
  const listingId = db.prepare("INSERT INTO listings (source, company, role) VALUES ('test', ?, ?)")
    .run(company, role).lastInsertRowid;
  return db.prepare("INSERT INTO claims (listing_id, stage) VALUES (?, 'Staked')")
    .run(listingId).lastInsertRowid;
}

test('a lead is recorded with no claim in existence', () => {
  const db = freshDb();
  try {
    addThread(db);
    const out = computeOutreach(db);
    assert.equal(out.totals.threads, 1);
    assert.equal(out.totals.open, 1);
    assert.equal(db.prepare('SELECT COUNT(*) FROM claims').pluck().get(), 0,
      'recording a lead must not invent an application that was never made');
    assert.equal(out.threads[0].company, 'Amazon');
  } finally { db.close(); }
});

test('the thread log is append-only and ordered', () => {
  const db = freshDb();
  try {
    const threadId = addThread(db);
    db.prepare("INSERT INTO outreach_messages (thread_id, direction, body, occurred_at) VALUES (?, 'inbound', 'Hi', '2026-07-18 12:00:00')").run(threadId);
    db.prepare("INSERT INTO outreach_messages (thread_id, direction, body, occurred_at) VALUES (?, 'outbound', 'Tell me more', '2026-07-19 09:00:00')").run(threadId);
    const out = computeOutreach(db);
    assert.equal(out.threads[0].message_count, 2);
    assert.equal(out.threads[0].last_message_at, '2026-07-19 09:00:00');
    assert.equal(out.totals.messages, 2);
    assert.deepEqual(OUTREACH_DIRECTIONS, ['inbound', 'outbound']);
  } finally { db.close(); }
});

test('converting preserves the origin edge and marks the claim as inbound-sourced', () => {
  const db = freshDb();
  try {
    const threadId = addThread(db);
    const claimId = seedClaim(db);
    const result = convertThreadToClaim(db, threadId, { claimId });
    assert.equal(result.thread.status, 'converted');
    assert.equal(result.thread.converted_claim_id, claimId);

    const out = computeOutreach(db);
    assert.equal(out.attribution.total_claims, 1);
    assert.equal(out.attribution.from_outreach, 1);
    assert.equal(out.attribution.from_search, 0);
    assert.equal(out.attribution.share_from_outreach, 100);
  } finally { db.close(); }
});

test('attribution separates claims that came to David from ones he found', () => {
  const db = freshDb();
  try {
    const threadId = addThread(db);
    const inbound = seedClaim(db, { company: 'Amazon' });
    seedClaim(db, { company: 'Found Co' });
    seedClaim(db, { company: 'Also Found Co' });
    convertThreadToClaim(db, threadId, { claimId: inbound });

    const { attribution } = computeOutreach(db);
    assert.equal(attribution.total_claims, 3);
    assert.equal(attribution.from_outreach, 1);
    assert.equal(attribution.from_search, 2);
    assert.ok(Math.abs(attribution.share_from_outreach - 33.33) < 0.1);
  } finally { db.close(); }
});

test('an empty tracker has no attribution share rather than zero percent', () => {
  const db = freshDb();
  try {
    assert.equal(computeOutreach(db).attribution.share_from_outreach, null);
  } finally { db.close(); }
});

test('a thread cannot be silently re-pointed at a different claim', () => {
  const db = freshDb();
  try {
    const threadId = addThread(db);
    const first = seedClaim(db);
    const second = seedClaim(db, { company: 'Other Co' });
    convertThreadToClaim(db, threadId, { claimId: first });
    assert.throws(
      () => convertThreadToClaim(db, threadId, { claimId: second }),
      (err) => err instanceof OutreachConvertError && err.status === 409,
    );
    // Re-converting to the SAME claim is idempotent, not an error.
    assert.equal(convertThreadToClaim(db, threadId, { claimId: first }).thread.converted_claim_id, first);
  } finally { db.close(); }
});

test('converting requires a real claim rather than manufacturing a listing', () => {
  const db = freshDb();
  try {
    const threadId = addThread(db);
    assert.throws(
      () => convertThreadToClaim(db, threadId, { claimId: 999 }),
      (err) => err instanceof OutreachConvertError && err.status === 400,
    );
    assert.equal(db.prepare('SELECT COUNT(*) FROM listings').pluck().get(), 0,
      'a recruiter pitch must never become a captured snapshot');
  } finally { db.close(); }
});

test('deleting the claim releases the edge without rewriting that the outreach converted', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-outreach-'));
  try {
    const threadId = addThread(db);
    const claimId = seedClaim(db);
    convertThreadToClaim(db, threadId, { claimId });

    deleteClaimById(db, claimId, backupDir);

    const out = computeOutreach(db);
    const [thread] = out.threads;
    assert.equal(thread.status, 'converted', 'the outreach really did convert; that stays true');
    assert.equal(thread.converted_claim_id, null, 'only the edge is released');
    assert.equal(thread.converted_claim_missing, true, 'and the gap is reported rather than hidden');
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    assert.equal(out.attribution.from_outreach, 0);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('status vocabulary is stable', () => {
  assert.deepEqual(OUTREACH_STATUSES, ['open', 'converted', 'declined', 'dead']);
});
