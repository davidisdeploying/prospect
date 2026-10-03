import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {
  DFW_OEWS_SNAPSHOT_SHA256,
  backfillSalaryGuidance,
  buildSalaryGuidance,
  ensureSalaryGuidance,
  matchDfwOccupation,
} from '../server/salaryGuidance.js';

const tableSql = `
  CREATE TABLE listings (
    id INTEGER PRIMARY KEY, role TEXT, seniority TEXT, description TEXT,
    annual_comp_min REAL, annual_comp_max REAL
  );
  CREATE TABLE claims (id INTEGER PRIMARY KEY, listing_id INTEGER REFERENCES listings(id));
  CREATE TABLE salary_guidance (
    id INTEGER PRIMARY KEY, claim_id INTEGER NOT NULL, listing_id INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL, area_code TEXT NOT NULL, area_title TEXT NOT NULL, data_period TEXT NOT NULL,
    occupation_code TEXT, occupation_title TEXT, mapping_rule TEXT NOT NULL, mapping_confidence TEXT NOT NULL,
    employment INTEGER, annual_p25 INTEGER, annual_median INTEGER, annual_p75 INTEGER,
    suggested_min INTEGER, suggested_max INTEGER, range_basis TEXT, response_text TEXT,
    unavailable_reason TEXT, source_name TEXT NOT NULL, source_url TEXT NOT NULL,
    source_series_json TEXT, source_retrieved_at TEXT NOT NULL, dataset_sha256 TEXT NOT NULL,
    generated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

test('DFW guidance maps infrastructure engineer to systems administration market data', () => {
  const match = matchDfwOccupation('Infrastructure Engineer');
  assert.equal(match.code, '15-1244');
  const guidance = buildSalaryGuidance({ role: 'Infrastructure Engineer' });
  assert.equal(guidance.status, 'ready');
  assert.equal(guidance.annual_p25, 80990);
  assert.equal(guidance.annual_median, 103260);
  assert.equal(guidance.annual_p75, 130470);
  assert.equal(guidance.suggested_min, 103000);
  assert.equal(guidance.suggested_max, 130000);
  assert.equal(guidance.response_text, "My target base salary is $110,000–$130,000, depending on the role's scope and total compensation.");
  assert.match(DFW_OEWS_SNAPSHOT_SHA256, /^[a-f0-9]{64}$/);
});

test('entry-level titles use the 25th-percentile-to-median band', () => {
  const guidance = buildSalaryGuidance({ role: 'Junior Cloud Engineer' });
  assert.equal(guidance.occupation_code, '15-1244');
  assert.equal(guidance.range_basis, '25th percentile to median');
  assert.equal(guidance.suggested_min, 81000);
  assert.equal(guidance.suggested_max, 103000);
  assert.equal(guidance.response_text, "My target base salary is $90,000–$100,000, depending on the role's scope and total compensation.");
});

test('unsupported titles produce an explicit unavailable record, not a fabricated benchmark', () => {
  const guidance = buildSalaryGuidance({ role: 'Information Technology Professional' });
  assert.equal(guidance.status, 'unavailable');
  assert.equal(guidance.occupation_code, undefined);
  assert.match(guidance.unavailable_reason, /No reliable BLS occupation match/);
});

test('guidance persists once per immutable listing and backfill is idempotent', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(tableSql);
  db.prepare("INSERT INTO listings (id, role) VALUES (1, 'Infrastructure Engineer'), (2, 'Desktop Support Specialist')").run();
  db.prepare('INSERT INTO claims (id, listing_id) VALUES (10, 1), (20, 2)').run();

  const first = ensureSalaryGuidance(db, { claimId: 10, listingId: 1 });
  const second = ensureSalaryGuidance(db, { claimId: 10, listingId: 1 });
  assert.equal(first.id, second.id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM salary_guidance WHERE listing_id=1').get().n, 1);

  assert.deepEqual(backfillSalaryGuidance(db), { inserted: 1, total: 1 });
  assert.deepEqual(backfillSalaryGuidance(db), { inserted: 0, total: 0 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM salary_guidance').get().n, 2);
  db.close();
});

test('captured employer range intersects the market anchor without rewriting stored BLS guidance', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(tableSql);
  db.prepare('INSERT INTO listings (id, role, description) VALUES (?, ?, ?)').run(
    1,
    'Infrastructure Engineer',
    'Base salary range for this role is $80,000 - $120,000. Benefits are separate.',
  );
  db.prepare('INSERT INTO claims (id, listing_id) VALUES (10, 1)').run();

  const guidance = ensureSalaryGuidance(db, { claimId: 10, listingId: 1 });
  assert.equal(guidance.market_suggested_min, 103000);
  assert.equal(guidance.market_suggested_max, 130000);
  assert.equal(guidance.employer_range_min, 80000);
  assert.equal(guidance.employer_range_max, 120000);
  assert.equal(guidance.suggested_min, 103000);
  assert.equal(guidance.suggested_max, 120000);
  assert.equal(guidance.answer_min, 110000);
  assert.equal(guidance.answer_max, 120000);
  assert.equal(guidance.response_text, "My target base salary is $110,000–$120,000, depending on the role's scope and total compensation.");
  assert.doesNotMatch(guidance.response_text, /within the employer/i);
  assert.match(guidance.range_basis, /intersected with employer posted range/);

  const stored = db.prepare('SELECT suggested_min, suggested_max FROM salary_guidance WHERE listing_id=1').get();
  assert.deepEqual(stored, { suggested_min: 103000, suggested_max: 130000 });
  db.close();
});
