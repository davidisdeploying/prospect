// §6.3 — deterministic liveness, the data pledge, and the honesty ledger.
//
// The load-bearing assertions here are the negative ones. The whole point of §6.3 is that each of
// these three surfaces refuses to overclaim: liveness marks what it cannot decide as residue rather
// than guessing, the pledge lists egress it would be more flattering to omit, and the ledger
// declines to report a completion rate it has no evidence for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';
import { computeLiveness, LIVENESS_VERDICTS } from '../server/liveness.js';
import {
  classifyCommitmentChange,
  recordNextActionChange,
  computeHonestyLedger,
} from '../server/nextActionCommitments.js';
import { computePledge, renderPledgeHtml } from '../server/pledge.js';

const schemaSql = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');

function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

function seedClaim(db, { company = 'Acme', role = 'Support Engineer', stage = 'Staked', outcomeReason = null, externalJobId = null, capturedAt = null } = {}) {
  const listing = db.prepare(`
    INSERT INTO listings (source, company, role, external_job_id, captured_at)
    VALUES ('test', ?, ?, ?, COALESCE(?, datetime('now')))
  `).run(company, role, externalJobId, capturedAt);
  return db.prepare(`
    INSERT INTO claims (listing_id, stage, outcome_reason) VALUES (?, ?, ?)
  `).run(listing.lastInsertRowid, stage, outcomeReason).lastInsertRowid;
}

function seedDiscovery(db, { claimId = null, externalJobId = null, lastSeenAt, status = 'new' }) {
  return db.prepare(`
    INSERT INTO scout_discoveries (
      source, source_key, external_job_id, source_url, role, status,
      first_seen_at, last_seen_at, fit_score, fit_label, assessment_json, linked_claim_id
    ) VALUES ('linkedin', ?, ?, 'https://example.com/j/1', 'Support Engineer', ?, ?, ?, 50, 'fair', '{}', ?)
  `).run(`key-${Math.random()}`, externalJobId, status, lastSeenAt, lastSeenAt, claimId).lastInsertRowid;
}

const NOW = new Date('2026-08-09T12:00:00.000Z');
function daysAgo(days) {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

// --- liveness ---------------------------------------------------------------------------------

test('a claim with no linked discovery is unobservable residue, never a guess', () => {
  const db = freshDb();
  try {
    seedClaim(db);
    const result = computeLiveness(db, { now: NOW });
    assert.equal(result.claims.length, 1);
    const [claim] = result.claims;
    assert.equal(claim.verdict, 'unobservable');
    assert.equal(claim.residue, true);
    assert.equal(claim.decided, false);
    assert.equal(claim.live, null, 'an unobservable claim must not be asserted live or dead');
    assert.equal(result.residue.length, 1);
    assert.equal(result.decided.length, 0);
  } finally { db.close(); }
});

test('a recent alert sighting decides the claim live; a lapsed one is residue, not dead', () => {
  const db = freshDb();
  try {
    const fresh = seedClaim(db, { company: 'Fresh Co' });
    seedDiscovery(db, { claimId: fresh, lastSeenAt: daysAgo(2) });
    const lapsed = seedClaim(db, { company: 'Lapsed Co' });
    seedDiscovery(db, { claimId: lapsed, lastSeenAt: daysAgo(40) });

    const result = computeLiveness(db, { now: NOW });
    const byCompany = new Map(result.claims.map((c) => [c.company, c]));

    assert.equal(byCompany.get('Fresh Co').verdict, 'live_sighted');
    assert.equal(byCompany.get('Fresh Co').live, true);
    assert.equal(byCompany.get('Fresh Co').decided, true);

    const lapsedRow = byCompany.get('Lapsed Co');
    assert.equal(lapsedRow.verdict, 'sighting_lapsed');
    assert.equal(lapsedRow.residue, true, 'a lapsed sighting is ambiguous, not a death certificate');
    assert.equal(lapsedRow.live, null);
    assert.equal(lapsedRow.evidence.days_since_last_sighting, 40);
  } finally { db.close(); }
});

test('the claim record itself decides closure without any inference', () => {
  const db = freshDb();
  try {
    seedClaim(db, { company: 'Tailings Co', stage: 'Tailings' });
    seedClaim(db, { company: 'Reasoned Co', outcomeReason: 'rejected' });
    const result = computeLiveness(db, { now: NOW });
    for (const claim of result.claims) {
      assert.equal(claim.verdict, 'closed_by_record');
      assert.equal(claim.decided, true);
      assert.equal(claim.live, false);
      assert.equal(claim.residue, false);
    }
    assert.equal(result.counts.closed_by_record, 2);
  } finally { db.close(); }
});

test('a hand-staked claim is matched to an alert by external job id', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { externalJobId: 'ext-4242' });
    seedDiscovery(db, { claimId: null, externalJobId: 'ext-4242', lastSeenAt: daysAgo(1) });
    const [claim] = computeLiveness(db, { now: NOW }).claims;
    assert.equal(claim.claim_id, claimId);
    assert.equal(claim.verdict, 'live_sighted');
    assert.ok(claim.evidence.discovery_id, 'the matched discovery is carried as evidence');
  } finally { db.close(); }
});

test('liveness carries evidence on every row so §6.7.3 never re-derives the residue set', () => {
  const db = freshDb();
  try {
    seedClaim(db, { capturedAt: daysAgo(30) });
    const result = computeLiveness(db, { now: NOW });
    const [claim] = result.claims;
    assert.equal(claim.evidence.days_since_capture, 30);
    for (const key of ['outcome_reason', 'days_since_capture', 'days_since_activity', 'discovery_id', 'days_since_last_sighting']) {
      assert.ok(key in claim.evidence, `evidence must carry ${key}`);
    }
    assert.deepEqual(
      result.residue.map((r) => r.claim_id),
      result.claims.filter((r) => !LIVENESS_VERDICTS[r.verdict].decided).map((r) => r.claim_id),
    );
  } finally { db.close(); }
});

test('liveness never opens a network connection', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'server', 'liveness.js'), 'utf8');
  const executable = source.split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
  for (const forbidden of ['fetch(', 'http.request', 'https.request', 'net.connect']) {
    assert.equal(executable.includes(forbidden), false, `liveness must not call ${forbidden} — no crawler is allowed`);
  }
});

// --- honesty ledger ---------------------------------------------------------------------------

test('commitment changes are classified as promised, revised, or cleared', () => {
  assert.equal(classifyCommitmentChange({ action: null }, { action: 'Follow up' }), 'promised');
  assert.equal(classifyCommitmentChange({ action: 'Follow up' }, { action: null }), 'cleared');
  assert.equal(classifyCommitmentChange({ action: 'Follow up' }, { action: 'Follow up again' }), 'revised');
  assert.equal(
    classifyCommitmentChange({ action: 'Follow up', due_date: '2026-08-01' }, { action: 'Follow up', due_date: '2026-08-08' }),
    'revised',
    'moving only the date is still a revision',
  );
  assert.equal(classifyCommitmentChange({ action: 'Follow up' }, { action: 'Follow up' }), null, 'an unchanged pair records nothing');
  assert.equal(classifyCommitmentChange({ action: null }, { action: null }), null);
  assert.equal(classifyCommitmentChange({ action: null }, { action: '   ' }), null, 'whitespace is not a promise');
});

test('the ledger counts slip only when a due date moves later', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    recordNextActionChange(db, claimId, { action: null, due_date: null }, { action: 'Follow up', due_date: '2026-08-01' });
    recordNextActionChange(db, claimId, { action: 'Follow up', due_date: '2026-08-01' }, { action: 'Follow up', due_date: '2026-08-06' });
    recordNextActionChange(db, claimId, { action: 'Follow up', due_date: '2026-08-06' }, { action: 'Follow up', due_date: '2026-08-04' });

    const ledger = computeHonestyLedger(db, { today: '2026-08-09' });
    assert.equal(ledger.totals.promised, 1);
    assert.equal(ledger.totals.revised, 2);
    assert.equal(ledger.slip.moved_count, 1, 'pulling a date earlier is a tightened commitment, not slip');
    assert.equal(ledger.slip.total_days, 5);
  } finally { db.close(); }
});

test('the ledger reports cleared timing but never a completion rate', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db);
    db.prepare(`
      INSERT INTO next_action_commitments (claim_id, event, action, due_date, prev_action, prev_due_date, recorded_at)
      VALUES (?, 'cleared', NULL, NULL, 'Follow up', '2026-08-01', '2026-08-05 10:00:00')
    `).run(claimId);
    db.prepare(`
      INSERT INTO next_action_commitments (claim_id, event, action, due_date, prev_action, prev_due_date, recorded_at)
      VALUES (?, 'cleared', NULL, NULL, 'Call back', '2026-08-06', '2026-08-04 10:00:00')
    `).run(claimId);

    const ledger = computeHonestyLedger(db, { today: '2026-08-09' });
    assert.equal(ledger.cleared_timing.after_due, 1);
    assert.equal(ledger.cleared_timing.before_or_on_due, 1);
    assert.equal('completed' in ledger.totals, false, 'the ledger must not claim completion it cannot observe');
    assert.equal('completion_rate' in ledger, false);
  } finally { db.close(); }
});

test('open commitments come from the live columns so pre-ledger promises still count', () => {
  const db = freshDb();
  try {
    const claimId = seedClaim(db, { company: 'Older Co' });
    // Set directly, as a claim migrated in from before migration 018 would have been.
    db.prepare("UPDATE claims SET next_action = 'Chase recruiter', next_action_date = '2026-08-01' WHERE id = ?").run(claimId);
    const ledger = computeHonestyLedger(db, { today: '2026-08-09' });
    assert.equal(ledger.totals.promised, 0, 'nothing was recorded, and the ledger does not invent it');
    assert.equal(ledger.open.count, 1);
    assert.equal(ledger.open.overdue, 1);
    assert.equal(ledger.open.claims[0].company, 'Older Co');
    assert.equal(ledger.open.claims[0].days_until_due, -8);
  } finally { db.close(); }
});

// --- data pledge ------------------------------------------------------------------------------

test('the pledge lists every egress path, including the unflattering ones', () => {
  const db = freshDb();
  try {
    const pledge = computePledge(db, { env: {} });
    const keys = pledge.egress.map((row) => row.key).sort();
    assert.deepEqual(keys, ['gmail', 'ollama', 'push'], 'all three network paths must be disclosed');
    for (const row of pledge.egress) {
      assert.ok(row.detail && row.detail.length > 20, `${row.key} must say what goes there`);
      assert.equal(typeof row.active, 'boolean');
    }
  } finally { db.close(); }
});

test('an idle egress path is still disclosed rather than hidden', () => {
  const db = freshDb();
  try {
    const pledge = computePledge(db, { env: {} });
    const push = pledge.egress.find((row) => row.key === 'push');
    assert.equal(push.active, false, 'no subscriptions on a fresh db');
    const html = renderPledgeHtml(pledge);
    assert.ok(html.includes('Web Push'), 'the idle path is still named in the rendered page');
  } finally { db.close(); }
});

test('the pledge reads model gates from live config rather than asserting them off', () => {
  const db = freshDb();
  try {
    const off = computePledge(db, { env: {} });
    assert.deepEqual(off.model_gates, { embeddings: false, llm_parse: false, skill_extract: false, advisor: false });
    assert.equal(off.egress.find((row) => row.key === 'ollama').active, false);

    const on = computePledge(db, { env: { PROSPECT_ADVISOR: '1' } });
    assert.equal(on.model_gates.advisor, true);
    assert.equal(on.egress.find((row) => row.key === 'ollama').active, true, 'a live gate shows up as live egress');
  } finally { db.close(); }
});

test('the pledge page renders legibly with no JavaScript', () => {
  const db = freshDb();
  try {
    seedClaim(db);
    const html = renderPledgeHtml(computePledge(db, { env: {} }));
    const body = html.slice(html.indexOf('<body>'));
    assert.equal(/<script(?![^>]*src="\/pwa-register\.js")/.test(body), false, 'no inline or extra script in the body');
    assert.ok(html.includes('Data pledge'));
    assert.ok(html.includes('next_action_commitments'), 'the append-only ledger is disclosed');
    for (const fragment of ['Where it lives', 'What leaves this machine', 'What is never quietly rewritten']) {
      assert.ok(html.includes(fragment), `missing section: ${fragment}`);
    }
  } finally { db.close(); }
});

test('every page reaches the pledge from the shared shell footer', async () => {
  const { renderSidebarNav } = await import('../server/shell.js');
  assert.ok(renderSidebarNav('/report').includes('href="/pledge"'));
});
