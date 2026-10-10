// §6.4 — selection-process intelligence: interview log, question bank, company process artifacts.
//
// The recurring theme in these assertions: a sample of one is never dressed up as a pattern, and a
// question is filed under the company that actually asked it rather than wherever a client says.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import { computeSelectionIntel, INTERVIEW_KINDS, ARTIFACT_KINDS, interviewKindGloss } from '../server/selection.js';
import { getClaimOffice, renderClaimOfficeHtml } from '../server/claimoffice.js';
import { deleteClaimById } from '../server/deleteClaim.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedCompanyClaim(db, { company = 'Acme', role = 'Support Engineer' } = {}) {
  const companyId = db.prepare('INSERT INTO companies (name, canonical_name) VALUES (?, ?)')
    .run(company, company.toLowerCase()).lastInsertRowid;
  const listingId = db.prepare(`
    INSERT INTO listings (source, company, role, company_id) VALUES ('test', ?, ?, ?)
  `).run(company, role, companyId).lastInsertRowid;
  const claimId = db.prepare("INSERT INTO claims (listing_id, stage) VALUES (?, 'Working the Vein')")
    .run(listingId).lastInsertRowid;
  return { companyId, listingId, claimId };
}

function addInterview(db, claimId, fields) {
  return db.prepare(`
    INSERT INTO interviews (claim_id, kind, format, scheduled_at, occurred_at, duration_minutes, outcome_note)
    VALUES (@claim_id, @kind, @format, @scheduled_at, @occurred_at, @duration_minutes, @outcome_note)
  `).run({
    claim_id: claimId, kind: 'phone_screen', format: null,
    scheduled_at: null, occurred_at: null, duration_minutes: null, outcome_note: null,
    ...fields,
  }).lastInsertRowid;
}

function addQuestion(db, { claimId, companyId, question }) {
  return db.prepare(`
    INSERT INTO interview_questions (claim_id, company_id, question) VALUES (?, ?, ?)
  `).run(claimId, companyId, question).lastInsertRowid;
}

test('an empty selection model is available but explicitly empty', () => {
  const db = freshDb();
  try {
    const intel = computeSelectionIntel(db);
    assert.equal(intel.available, true);
    assert.deepEqual(intel.totals, { interviews: 0, held: 0, scheduled_not_held: 0, questions: 0, artifacts: 0 });
    assert.deepEqual(intel.question_bank.recurring, []);
  } finally { db.close(); }
});

test('an interview scheduled but never held is a distinct, named outcome', () => {
  const db = freshDb();
  try {
    const { claimId } = seedCompanyClaim(db);
    addInterview(db, claimId, { kind: 'panel', scheduled_at: '2026-07-01', occurred_at: null });
    addInterview(db, claimId, { kind: 'technical', scheduled_at: '2026-07-02', occurred_at: '2026-07-02' });

    const intel = computeSelectionIntel(db);
    assert.equal(intel.totals.interviews, 2);
    assert.equal(intel.totals.held, 1);
    assert.equal(intel.totals.scheduled_not_held, 1, 'a no-show is a real outcome, not missing data');
  } finally { db.close(); }
});

test('a stage seen once is not reported as recurring', () => {
  const db = freshDb();
  try {
    const { claimId } = seedCompanyClaim(db, { company: 'Once Co' });
    addInterview(db, claimId, { kind: 'phone_screen', occurred_at: '2026-07-01' });
    let intel = computeSelectionIntel(db);
    assert.equal(intel.companies[0].stages[0].recurring, false, 'one sighting is one sighting');

    addInterview(db, claimId, { kind: 'phone_screen', occurred_at: '2026-07-08' });
    intel = computeSelectionIntel(db);
    assert.equal(intel.companies[0].stages[0].count, 2);
    assert.equal(intel.companies[0].stages[0].recurring, true);
  } finally { db.close(); }
});

test('the question bank surfaces recurrence across companies, ignoring casing and punctuation', () => {
  const db = freshDb();
  try {
    const a = seedCompanyClaim(db, { company: 'Alpha' });
    const b = seedCompanyClaim(db, { company: 'Beta' });
    addQuestion(db, { claimId: a.claimId, companyId: a.companyId, question: 'Tell me about a hard outage.' });
    addQuestion(db, { claimId: b.claimId, companyId: b.companyId, question: 'tell me about a hard outage' });
    addQuestion(db, { claimId: a.claimId, companyId: a.companyId, question: 'Why this company?' });

    const intel = computeSelectionIntel(db);
    assert.equal(intel.question_bank.total, 3);
    assert.equal(intel.question_bank.recurring.length, 1, 'only the repeated question recurs');
    assert.equal(intel.question_bank.recurring[0].times_asked, 2);
    assert.deepEqual(intel.question_bank.recurring[0].companies, ['Alpha', 'Beta']);
  } finally { db.close(); }
});

test('process artifacts belong to the company and outlive the claim they were learned from', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-selection-'));
  try {
    const { companyId, claimId } = seedCompanyClaim(db, { company: 'Gauntlet Corp' });
    db.prepare(`
      INSERT INTO company_process_artifacts (company_id, kind, title, source_claim_id)
      VALUES (?, 'assessment_guide', 'Four-section assessment', ?)
    `).run(companyId, claimId);

    deleteClaimById(db, claimId, backupDir);

    const intel = computeSelectionIntel(db);
    assert.equal(intel.totals.artifacts, 1, 'the artifact survives the claim being deleted');
    assert.equal(intel.companies[0].artifacts[0].title, 'Four-section assessment');
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('hard delete cascades interviews and banked questions', () => {
  const db = freshDb();
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-selection-del-'));
  try {
    const { claimId, companyId } = seedCompanyClaim(db);
    const interviewId = addInterview(db, claimId, { kind: 'technical', occurred_at: '2026-07-02' });
    db.prepare(`
      INSERT INTO interview_questions (claim_id, company_id, interview_id, question)
      VALUES (?, ?, ?, 'Explain DNS')
    `).run(claimId, companyId, interviewId);

    const result = deleteClaimById(db, claimId, backupDir);
    assert.equal(result.deleted, true);
    assert.equal(db.prepare('SELECT COUNT(*) FROM interviews').pluck().get(), 0);
    assert.equal(db.prepare('SELECT COUNT(*) FROM interview_questions').pluck().get(), 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);

    const backup = JSON.parse(fs.readFileSync(result.backup_path, 'utf8'));
    assert.equal(backup.interviews.length, 1);
    assert.equal(backup.interview_questions.length, 1);
  } finally {
    db.close();
    fs.rmSync(backupDir, { recursive: true, force: true });
  }
});

test('the Claim Office renders the selection section JS-free', () => {
  const db = freshDb();
  try {
    const { claimId, companyId } = seedCompanyClaim(db, { company: 'Render Co' });
    addInterview(db, claimId, { kind: 'onsite', occurred_at: '2026-07-05' });
    addQuestion(db, { claimId, companyId, question: 'Walk me through a migration' });

    const html = renderClaimOfficeHtml(getClaimOffice(db));
    const body = html.slice(html.indexOf('<body>'));
    assert.equal(/<script(?![^>]*src="\/pwa-register\.js")/.test(body), false);
    assert.ok(html.includes('Selection process'));
    assert.ok(html.includes('Render Co'));
    assert.ok(html.includes('On-site'), 'the interview kind is glossed for a reader');
  } finally { db.close(); }
});

test('kind vocabularies are stable and glossed', () => {
  assert.ok(INTERVIEW_KINDS.includes('assessment'), 'the motivating Amazon case was an assessment');
  assert.ok(ARTIFACT_KINDS.includes('assessment_guide'));
  assert.equal(interviewKindGloss('recruiter_screen'), 'Recruiter screen');
  assert.equal(interviewKindGloss('nonsense'), 'nonsense', 'an unknown kind is shown, not swallowed');
});
