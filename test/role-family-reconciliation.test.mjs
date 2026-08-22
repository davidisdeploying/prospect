import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { computeReconciliation } from '../server/roleFamilyReconciliation.js';
import { getHuntReport, renderHuntReportHtml } from '../server/huntReport.js';
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

function insertListing(db, { role = 'Role', jobFamily = null, roleFamily = null, roleHint = undefined } = {}) {
  const parsed = roleHint === undefined ? null : JSON.stringify({ llm_parse: { role_hint: roleHint } });
  const info = db.prepare(`
    INSERT INTO listings (source, role, job_family, role_family, parsed) VALUES ('Manual', ?, ?, ?, ?)
  `).run(role, jobFamily, roleFamily, parsed);
  return info.lastInsertRowid;
}

function dbState(db) {
  return {
    user_version: db.pragma('user_version', { simple: true }),
    listings: db.prepare('SELECT count(*) AS n FROM listings').get().n,
    role_family_values: db.prepare('SELECT role_family FROM listings ORDER BY id').all(),
    job_family_values: db.prepare('SELECT job_family FROM listings ORDER BY id').all(),
  };
}

test('a listing with no role_hint yet is not comparable (agrees is null, not counted either way)', () => {
  const db = freshDb();
  insertListing(db, { role: 'IT Support Tech', jobFamily: 'it_support' });

  const { items, summary } = computeReconciliation(db);
  assert.equal(items.length, 1);
  assert.equal(items[0].role_hint, null);
  assert.equal(items[0].agrees, null);
  assert.equal(summary.comparable, 0);
  assert.equal(summary.agree, 0);
  assert.equal(summary.disagree, 0);
});

test('role_hint classified via the same deterministic rules as job_family, and matching counts as agreement', () => {
  const db = freshDb();
  insertListing(db, { role: 'Data Center Technician', jobFamily: 'datacenter', roleHint: 'Data Center Hardware Engineer' });

  const { items, summary } = computeReconciliation(db);
  assert.equal(items[0].role_hint_family, 'datacenter');
  assert.equal(items[0].agrees, true);
  assert.equal(summary.comparable, 1);
  assert.equal(summary.agree, 1);
  assert.equal(summary.disagree, 0);
});

test('a role_hint that classifies differently from the title-derived job_family is flagged as disagreement, never auto-resolved', () => {
  const db = freshDb();
  // Mirrors a real live case: title says desktop_support, the LLM's prose-derived hint reads it support.
  insertListing(db, { role: 'Desktop Support Technician', jobFamily: 'desktop_support', roleHint: 'IT Support Technician' });

  const { items, summary } = computeReconciliation(db);
  assert.equal(items[0].job_family, 'desktop_support');
  assert.equal(items[0].role_hint_family, 'it_support');
  assert.equal(items[0].agrees, false);
  assert.equal(summary.disagree, 1);
  assert.equal(summary.agree, 0);
});

test('both signals landing on uncategorized counts as agreement, not a missed recovery', () => {
  const db = freshDb();
  insertListing(db, { role: 'Deployment Technician', jobFamily: 'uncategorized', roleHint: 'Technician' });

  const { items, summary } = computeReconciliation(db);
  assert.equal(items[0].role_hint_family, 'uncategorized');
  assert.equal(items[0].agrees, true);
  assert.equal(summary.agree, 1);
});

test('a NULL job_family is treated as uncategorized for comparison, same as the Ore Types report', () => {
  const db = freshDb();
  insertListing(db, { role: 'Some Ambiguous Title', jobFamily: null, roleHint: 'Something Unrelated' });

  const { items } = computeReconciliation(db);
  assert.equal(items[0].job_family, 'uncategorized');
});

test('role_family (source-supplied enum) is reported verbatim and counted, but never derived or overwritten', () => {
  const db = freshDb();
  insertListing(db, { role: 'Desktop Support Specialist', jobFamily: 'desktop_support', roleFamily: 'engineering', roleHint: 'IT Support Engineer' });
  insertListing(db, { role: 'IT Support Tech', jobFamily: 'it_support', roleFamily: null, roleHint: 'IT Support Tech' });

  const before = dbState(db);
  const { items, summary } = computeReconciliation(db);
  const after = dbState(db);

  assert.deepEqual(after, before, 'computeReconciliation must perform zero writes');
  assert.equal(items[0].role_family, 'engineering');
  assert.equal(items[1].role_family, null);
  assert.equal(summary.role_family_supplied, 1);
});

test('a malformed parsed JSON value is treated as no-hint rather than thrown', () => {
  const db = freshDb();
  const info = db.prepare(`
    INSERT INTO listings (source, role, job_family, parsed) VALUES ('Manual', 'Some Role', 'it_support', 'not json')
  `).run();

  const { items } = computeReconciliation(db);
  const row = items.find((i) => i.id === info.lastInsertRowid);
  assert.equal(row.role_hint, null);
  assert.equal(row.agrees, null);
});

test('on a plain pre-job_family fixture, computeReconciliation degrades to an empty shape without throwing', () => {
  let sql = schemaSql.replace(/^PRAGMA user_version = \d+;/, 'PRAGMA user_version = 6;');
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  advisor_status TEXT/, '');
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  skill_extract_status TEXT/, '');
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  llm_parse_status TEXT/, '');
  sql = sql.replace(`  embedding_model TEXT,\n  job_family TEXT\n);`, `  embedding_model TEXT\n);`);
  assert.ok(!sql.includes('job_family'), 'string surgery is stale');
  assert.ok(!sql.includes('skill_extract_status'), 'string surgery is stale');
  assert.ok(!sql.includes('advisor_status'), 'string surgery is stale');

  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(sql);
  db.prepare(`INSERT INTO listings (source, role) VALUES ('Manual', 'Some Role')`).run();

  const { items, summary } = computeReconciliation(db);
  assert.deepEqual(items, []);
  assert.deepEqual(summary, { total: 0, comparable: 0, agree: 0, disagree: 0, role_family_supplied: 0 });
});

test('getHuntReport/renderHuntReportHtml surface the Role Signal Check section without throwing', () => {
  const db = freshDb();
  insertListing(db, { role: 'Desktop Support Technician', jobFamily: 'desktop_support', roleFamily: 'engineering', roleHint: 'IT Support Technician' });

  const report = getHuntReport(db);
  assert.equal(report.job_family.reconciliation.summary.total, 1);

  const html = renderHuntReportHtml(report);
  assert.match(html, /Role Signal Check/);
  const section = html.slice(html.indexOf('Role Signal Check'), html.indexOf('</section>', html.indexOf('Role Signal Check')));
  assert.match(section, /disagree/);
  assert.match(section, /engineering/);
});
