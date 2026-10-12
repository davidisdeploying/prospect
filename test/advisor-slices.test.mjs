// §6.7.2 / §6.7.3 / §6.7.4 — the judgment-only advisor slices.
//
// The model is injected in every test, so none of this needs Ollama. What is actually under test is
// the boundary each slice sits behind: 6.7.3 must judge only what §6.3 could not decide, 6.7.4 must
// refuse to draft a nudge for something that is not due, and 6.7.2 must stay silent until there is
// something real to restate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import {
  adjudicateLiveness, synthesizeOutcomes, draftStatusCheck, dueContextFor,
  ADVISOR_SLICES, MIN_TAILINGS_N,
} from '../server/advisorSlices.js';
import { recordObservation } from '../server/vendorStatus.js';
import { deleteClaimById } from '../server/deleteClaim.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
const ON = { PROSPECT_ADVISOR: '1' };

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function addClaim(db, { stage = 'Staked', company = 'Acme', outcomeReason = null, nextAction = null, nextActionDate = null } = {}) {
  const listingId = db.prepare("INSERT INTO listings (source, company, role) VALUES ('test', ?, 'Support Engineer')")
    .run(company).lastInsertRowid;
  return db.prepare(`
    INSERT INTO claims (listing_id, stage, outcome_reason, next_action, next_action_date, applied_at)
    VALUES (?, ?, ?, ?, ?, '2026-07-01')
  `).run(listingId, stage, outcomeReason, nextAction, nextActionDate).lastInsertRowid;
}

const okAdjudication = async () => ({
  assessment: 'Only the passage of time is recorded here.',
  leaning: 'cannot_tell',
  confidence: 'low',
  suggested_check: 'Open the employer tracker and read the current status.',
});

// --- gating ------------------------------------------------------------------------------------

test('every slice is inert while PROSPECT_ADVISOR is off', async () => {
  const db = freshDb();
  try {
    addClaim(db);
    let called = 0;
    const generate = async () => { called += 1; return {}; };
    for (const result of [
      await adjudicateLiveness(db, { generate, env: {} }),
      await synthesizeOutcomes(db, { generate, env: {} }),
      await draftStatusCheck(db, 1, { generate, env: {} }),
    ]) {
      assert.equal(result.gated, true);
      assert.match(result.reason, /PROSPECT_ADVISOR/);
    }
    assert.equal(called, 0, 'a disabled slice must not reach the model at all');
  } finally { db.close(); }
});

// --- §6.7.3 ------------------------------------------------------------------------------------

test('6.7.3 judges only what the deterministic checker could not decide', async () => {
  const db = freshDb();
  try {
    const ambiguous = addClaim(db, { company: 'Ambiguous Co', stage: 'Staked' });
    // Decided by David's own record, so it must never be sent for judgment.
    addClaim(db, { company: 'Closed Co', stage: 'Tailings' });
    // Decided by the employer's tracker (§3.5b), likewise.
    const vendorClosed = addClaim(db, { company: 'Vendor Closed Co', stage: 'Staked' });
    recordObservation(db, vendorClosed, { statusText: 'Assessment expired' });

    const seen = [];
    const generate = async (messages) => { seen.push(messages[1].content); return okAdjudication(); };

    const result = await adjudicateLiveness(db, { generate, env: ON });
    assert.equal(result.gated, false);
    assert.equal(result.residue_count, 1);
    assert.equal(result.adjudications.length, 1);
    assert.equal(result.adjudications[0].claim_id, ambiguous);
    assert.equal(seen.length, 1, 'decided claims are never sent to the model');
    assert.ok(seen[0].includes('Ambiguous Co'));
  } finally { db.close(); }
});

test('6.7.3 says nothing at all when nothing is ambiguous', async () => {
  const db = freshDb();
  try {
    addClaim(db, { stage: 'Tailings' });
    let called = 0;
    const result = await adjudicateLiveness(db, { generate: async () => { called += 1; return {}; }, env: ON });
    assert.equal(result.generated, 0);
    assert.deepEqual(result.adjudications, []);
    assert.equal(called, 0);
  } finally { db.close(); }
});

test('6.7.3 stores its judgment and reuses it while the evidence is unchanged', async () => {
  const db = freshDb();
  try {
    addClaim(db, { company: 'Ambiguous Co' });
    let calls = 0;
    const generate = async () => { calls += 1; return okAdjudication(); };

    const first = await adjudicateLiveness(db, { generate, env: ON });
    assert.equal(first.generated, 1);
    const second = await adjudicateLiveness(db, { generate, env: ON });
    assert.equal(calls, 1, 'unchanged evidence must not re-run the model');
    assert.equal(second.adjudications[0].reused, true);
    assert.equal(db.prepare("SELECT COUNT(*) FROM advisor_outputs WHERE slice='6.7.3'").pluck().get(), 1);
  } finally { db.close(); }
});

test('6.7.3 refuses to inherit a confident leaning from an off-contract response', async () => {
  const db = freshDb();
  try {
    addClaim(db);
    const generate = async () => ({ assessment: 'It is definitely dead.', leaning: 'certainly_dead', confidence: 'high' });
    const result = await adjudicateLiveness(db, { generate, env: ON });
    const [adjudication] = result.adjudications;
    assert.equal(adjudication.leaning, 'cannot_tell', 'an unrecognized leaning degrades, never passes through');
    assert.equal(adjudication.confidence, 'low', 'and its confidence claim is not taken at face value');
  } finally { db.close(); }
});

test('6.7.3 reports a per-claim failure instead of dropping the claim silently', async () => {
  const db = freshDb();
  try {
    addClaim(db);
    const result = await adjudicateLiveness(db, { generate: async () => { throw new Error('model down'); }, env: ON });
    assert.equal(result.adjudications.length, 1);
    assert.match(result.adjudications[0].error, /model down/);
  } finally { db.close(); }
});

// --- §6.7.2 ------------------------------------------------------------------------------------

test('6.7.2 stays silent below its data gate and says what it needs', async () => {
  const db = freshDb();
  try {
    addClaim(db, { stage: 'Tailings', outcomeReason: 'rejected' });
    let called = 0;
    const result = await synthesizeOutcomes(db, { generate: async () => { called += 1; return {}; }, env: ON });
    assert.equal(result.gated, true);
    assert.equal(result.have, 1);
    assert.equal(result.need, MIN_TAILINGS_N);
    assert.equal(called, 0, 'the gate is checked before any model call');
  } finally { db.close(); }
});

test('6.7.2 restates once there is enough to restate', async () => {
  const db = freshDb();
  try {
    for (let i = 0; i < MIN_TAILINGS_N; i += 1) {
      addClaim(db, { stage: 'Tailings', company: `Co ${i}`, outcomeReason: i % 2 ? 'ghosted' : 'rejected' });
    }
    const generate = async () => ({
      restatement: 'Most ended without a reply; the rest were explicit rejections.',
      groups: [{ theme: 'no reply', claims: [1, 3], in_their_words: 'ghosted' }],
      unrecorded_count: 0,
    });
    const result = await synthesizeOutcomes(db, { generate, env: ON });
    assert.equal(result.gated, false);
    assert.equal(result.n, MIN_TAILINGS_N);
    assert.ok(result.synthesis.restatement);
    assert.equal(result.synthesis.groups[0].theme, 'no reply');
  } finally { db.close(); }
});

// --- §6.7.4 ------------------------------------------------------------------------------------

test('6.7.4 does not decide what is due; the SQL does', () => {
  const db = freshDb();
  try {
    const notDue = addClaim(db, { nextAction: 'Follow up', nextActionDate: '2026-12-01' });
    assert.equal(dueContextFor(db, notDue, { today: '2026-08-09' }).due, false);

    const due = addClaim(db, { company: 'Due Co', nextAction: 'Follow up', nextActionDate: '2026-08-01' });
    assert.equal(dueContextFor(db, due, { today: '2026-08-09' }).due, true);
  } finally { db.close(); }
});

test('6.7.4 refuses to draft a nudge for something that is not due', async () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db, { nextAction: 'Follow up', nextActionDate: '2026-12-01' });
    let called = 0;
    const result = await draftStatusCheck(db, claimId, {
      generate: async () => { called += 1; return {}; }, env: ON, today: '2026-08-09',
    });
    assert.equal(result.gated, true);
    assert.match(result.reason, /nothing is due/);
    assert.equal(called, 0, 'drafting busywork that reads like progress is the failure mode here');
  } finally { db.close(); }
});

test('6.7.4 drafts for a genuinely due claim and marks the result as a draft', async () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db, { company: 'Due Co', nextAction: 'Follow up', nextActionDate: '2026-08-01' });
    const generate = async () => ({
      subject: 'Following up on my application',
      body: 'Short and polite.',
      tone_note: 'Kept it brief given no prior reply.',
    });
    const result = await draftStatusCheck(db, claimId, { generate, env: ON, today: '2026-08-09' });
    assert.equal(result.gated, false);
    assert.equal(result.draft.subject, 'Following up on my application');
    assert.equal(result.draft.is_draft, true, 'never presented as something Prospect will send');
    assert.equal(db.prepare("SELECT COUNT(*) FROM advisor_outputs WHERE slice='6.7.4'").pluck().get(), 1);
  } finally { db.close(); }
});

test('an open employer deadline also counts as due', () => {
  const db = freshDb();
  try {
    const claimId = addClaim(db, { company: 'Deadline Co' });
    db.prepare("INSERT INTO claim_events (claim_id, kind, due_at) VALUES (?, 'assessment_requested', '2026-08-05')").run(claimId);
    assert.equal(dueContextFor(db, claimId, { today: '2026-08-09' }).due, true);

    // Resolving it closes the gate again.
    const eventId = db.prepare('SELECT id FROM claim_events WHERE claim_id = ?').pluck().get(claimId);
    db.prepare("INSERT INTO claim_events (claim_id, kind, payload) VALUES (?, 'deadline_resolved', ?)")
      .run(claimId, JSON.stringify({ resolved_event_id: eventId, resolution_reason: 'completed' }));
    assert.equal(dueContextFor(db, claimId, { today: '2026-08-09' }).due, false);
  } finally { db.close(); }
});

// --- housekeeping ------------------------------------------------------------------------------

test('deleting a claim removes judgments made about it', async () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-advisor-'));
  try {
    const claimId = addClaim(db, { company: 'Ambiguous Co' });
    await adjudicateLiveness(db, { generate: okAdjudication, env: ON });
    assert.equal(db.prepare('SELECT COUNT(*) FROM advisor_outputs').pluck().get(), 1);

    const result = deleteClaimById(db, claimId, backupDir);
    assert.equal(db.prepare('SELECT COUNT(*) FROM advisor_outputs').pluck().get(), 0,
      'a reused claim id must not inherit another claim verdicts');
    assert.equal(JSON.parse(fs.readFileSync(result.backup_path, 'utf8')).advisor_outputs.length, 1);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('slice vocabulary is stable', () => {
  assert.deepEqual(ADVISOR_SLICES, ['6.7.2', '6.7.3', '6.7.4']);
});
