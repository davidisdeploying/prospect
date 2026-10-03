import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { computeJobFamilyReport } from '../server/jobFamilyReport.js';
import { getHuntReport, renderHuntReportHtml } from '../server/huntReport.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaSql = readFileSync(path.join(__dirname, '../schema.sql'), 'utf8');

// schema.sql is v7 and already has job_family on listings, so a plain fresh fixture has the
// column. §4.7 is still feature-detected rather than coupled to a schema bump — the
// no-column degrade path is exercised below via a back-derived pre-007 fixture.
function freshDb() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(schemaSql);
  return db;
}

// Derives a v6-shaped schema (job_family column absent, user_version 6) by stripping
// job_family back out of the current (already-v7) schema.sql — mirrors
// test/job-family-capture.test.mjs's preJobFamilySchemaSql() approach.
function preJobFamilySchemaSql() {
  // Regex, not a literal version number -- schema.sql's head version moves with every
  // migration (stale hardcoded "= 7" is exactly what broke this helper's siblings at v8).
  let sql = schemaSql.replace(/^PRAGMA user_version = \d+;/, 'PRAGMA user_version = 6;');
  // migrations/013's advisor_status is now the listings tail, so it comes off before
  // skill_extract_status can be stripped in turn — same reasoning one generation later.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  advisor_status TEXT/, '');
  // migrations/012's skill_extract_status is now the listings tail, so it comes off before
  // llm_parse_status can be stripped in turn — same reasoning one generation later.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  skill_extract_status TEXT/, '');
  // migrations/010's llm_parse_status is now the listings tail, so it comes off first —
  // the literal below anchors on `job_family TEXT\n);`. Regex over the column and any
  // comment lines above it, so a reworded comment doesn't re-break this.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  llm_parse_status TEXT/, '');
  sql = sql.replace(
    `  embedding_model TEXT,\n  job_family TEXT\n);`,
    `  embedding_model TEXT\n);`,
  );
  assert.ok(!sql.includes('job_family'), 'preJobFamilySchemaSql: failed to strip job_family column — string surgery is stale');
  assert.ok(!sql.includes('llm_parse_status'), 'preJobFamilySchemaSql: failed to strip llm_parse_status column — string surgery is stale');
  assert.ok(!sql.includes('skill_extract_status'), 'preJobFamilySchemaSql: failed to strip skill_extract_status column — string surgery is stale');
  assert.ok(!sql.includes('advisor_status'), 'preJobFamilySchemaSql: failed to strip advisor_status column — string surgery is stale');
  return sql;
}

function freshDbNoJobFamily() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(preJobFamilySchemaSql());
  return db;
}

function insertListing(db, { company = 'Co', role = 'Role', jobFamily = null } = {}) {
  const hasCol = db.prepare(
    "SELECT COUNT(*) AS n FROM pragma_table_info('listings') WHERE name='job_family'"
  ).get().n > 0;
  const info = hasCol
    ? db.prepare(`
        INSERT INTO listings (source, company, role, job_family) VALUES ('Manual', ?, ?, ?)
      `).run(company, role, jobFamily)
    : db.prepare(`
        INSERT INTO listings (source, company, role) VALUES ('Manual', ?, ?)
      `).run(company, role);
  return info.lastInsertRowid;
}

function insertClaim(db, { listingId, appliedAt = null, stage = 'Staked' } = {}) {
  const info = db.prepare(`
    INSERT INTO claims (listing_id, stage, stage_entered_at, applied_at)
    VALUES (?, ?, ?, ?)
  `).run(listingId, stage, appliedAt, appliedAt);
  return info.lastInsertRowid;
}

function insertTransition(db, claimId, fromStage, toStage, transitionedAt) {
  db.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause)
    VALUES (?, ?, ?, ?, 'manual')
  `).run(claimId, fromStage, toStage, transitionedAt);
}

function dbState(db) {
  return {
    user_version: db.pragma('user_version', { simple: true }),
    claims: db.prepare('SELECT count(*) AS n FROM claims').get().n,
    listings: db.prepare('SELECT count(*) AS n FROM listings').get().n,
    stage_transitions: db.prepare('SELECT count(*) AS n FROM stage_transitions').get().n,
  };
}

test('distribution sums to the seeded claim count', () => {
  const db = freshDb();
  const a = insertListing(db, { company: 'A', role: 'Help Desk Tech', jobFamily: 'it_support' });
  const b = insertListing(db, { company: 'B', role: 'Desktop Support', jobFamily: 'desktop_support' });
  const c = insertListing(db, { company: 'C', role: 'Datacenter Tech', jobFamily: 'datacenter' });
  insertClaim(db, { listingId: a, appliedAt: '2026-07-01 15:00:00' });
  insertClaim(db, { listingId: b, appliedAt: '2026-07-01 15:00:00' });
  insertClaim(db, { listingId: c, appliedAt: '2026-07-01 15:00:00' });

  const report = computeJobFamilyReport(db);
  const total = report.distribution.reduce((sum, d) => sum + d.count, 0);
  assert.equal(total, 3);
});

test('a claim with NULL job_family buckets as uncategorized, not dropped', () => {
  const db = freshDb();
  const listingId = insertListing(db, { company: 'A', role: 'Some Ambiguous Title', jobFamily: null });
  insertClaim(db, { listingId, appliedAt: '2026-07-01 15:00:00' });

  const report = computeJobFamilyReport(db);
  assert.equal(report.distribution.length, 1);
  assert.equal(report.distribution[0].job_family, 'uncategorized');
  assert.equal(report.distribution[0].count, 1);
});

test('per-family funnel reflects ever-reached counts, including a claim that passed a stage then dropped', () => {
  const db = freshDb();
  const listingId = insertListing(db, { company: 'A', role: 'Help Desk Tech', jobFamily: 'it_support' });
  const claimId = insertClaim(db, { listingId, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, claimId, null, 'Showings', '2026-06-30 15:00:00');
  insertTransition(db, claimId, 'Showings', 'Staked', '2026-07-01 15:00:00');
  insertTransition(db, claimId, 'Staked', 'Working the Vein', '2026-07-03 15:00:00');
  insertTransition(db, claimId, 'Working the Vein', 'Tailings', '2026-07-05 15:00:00');

  const report = computeJobFamilyReport(db);
  const row = report.funnel.rows.find((r) => r.job_family === 'it_support');
  assert.ok(row, 'it_support row present');
  // Passed through Showings, Staked, and Working the Vein before dropping to Tailings — all still count
  // as ever-reached even though the claim's CURRENT stage is Tailings.
  assert.equal(row.counts['Showings'], 1);
  assert.equal(row.counts['Staked'], 1);
  assert.equal(row.counts['Working the Vein'], 1);
  assert.equal(row.counts['Tailings'], 1);
    assert.equal(row.counts['Strike'], 0);
});

test('computeJobFamilyReport performs zero writes', () => {
  const db = freshDb();
  const listingId = insertListing(db, { company: 'A', role: 'Help Desk Tech', jobFamily: 'it_support' });
  const claimId = insertClaim(db, { listingId, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, claimId, null, 'Showings', '2026-06-30 15:00:00');

  const before = dbState(db);
  computeJobFamilyReport(db);
  const after = dbState(db);
  assert.deepEqual(after, before);
});

test('on a plain v6 fixture (no job_family column), computeJobFamilyReport degrades to an empty shape without throwing', () => {
  const db = freshDbNoJobFamily();
  const listingId = insertListing(db, { company: 'A', role: 'Help Desk Tech' });
  const claimId = insertClaim(db, { listingId, appliedAt: '2026-07-01 15:00:00' });
  insertTransition(db, claimId, null, 'Showings', '2026-06-30 15:00:00');

  const report = computeJobFamilyReport(db);
  assert.deepEqual(report.distribution, []);
  assert.deepEqual(report.funnel.rows, []);
  assert.ok(report.funnel.stages.length > 0, 'stages shape is still populated from ALL_STAGES');
});

test('on a plain v6 fixture, getHuntReport and renderHuntReportHtml run without throwing and emit the empty-state section', () => {
  const db = freshDbNoJobFamily();
  const listingId = insertListing(db, { company: 'A', role: 'Help Desk Tech' });
  insertClaim(db, { listingId, appliedAt: '2026-07-01 15:00:00' });

  const report = getHuntReport(db);
  assert.deepEqual(report.job_family.distribution, []);

  const html = renderHuntReportHtml(report);
  assert.match(html, /Ore Types/);
  const oreTypesSection = html.slice(html.indexOf('Ore Types'), html.indexOf('</section>', html.indexOf('Ore Types')));
  assert.doesNotMatch(oreTypesSection, /bar-gold|value-gold/);
});
