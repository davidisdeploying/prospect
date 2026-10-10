// test/job-family-capture.test.mjs — §5.2.4 capture-time job_family wiring, over the
// real POST /api/claims route (server/index.js), spawned in a child process exactly
// like test/repost-semantic-capture.test.mjs (module-level side effects — db.js opens
// a real file, index.js calls app.listen at import time — need per-test isolation).
// Two scratch-DB branches: v7 (job_family column present, migration 007 applied) and
// v6 (schema.sql only, no column) — proving the boot-time feature-detect degrades
// cleanly on the pre-migration fixture shape that test/repost-semantic-capture.test.mjs
// already depends on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const schemaSql = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const indexPath = path.join(ROOT, 'server', 'index.js');

// Derives a v6-shaped schema (job_family column absent, user_version 6) by
// stripping job_family back out of the current (already-v7) schema.sql —
// mirrors test/embedding.test.mjs's preV6SchemaSql() approach, scoped to
// just this migration's own addition.
function preJobFamilySchemaSql() {
  // Regex, not a literal version number -- schema.sql's head version moves with every
  // migration (stale hardcoded "= 7" is exactly what broke this helper at v8).
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

const TEST_PORT = 8798;

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-job-family-capture-${label}-`));
  return path.join(dir, 'scratch.db');
}

function rmScratch(dbPath) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

// Runs POST /api/claims against a freshly-spawned real server (its own child process),
// with the doc-embed fetch stubbed to always fail (best-effort repost tier degrades to
// no candidate, per server/index.js's own try/catch — never blocks the stake). Mirrors
// test/repost-semantic-capture.test.mjs's runCapture helper.
function runCapture({ dbPath, claimBody }) {
  const scriptPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-job-family-capture-script-')) + '/run.mjs';
  fs.writeFileSync(scriptPath, `
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('simulated Ollama outage'); };

    await import(${JSON.stringify('file://' + indexPath)});
    await new Promise((r) => setTimeout(r, 200));

    const res = await realFetch('http://127.0.0.1:${TEST_PORT}/api/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(claimBody))},
    });
    const body = await res.json();
    console.log('RESULT_JSON:' + JSON.stringify({ status: res.status, body }));
    process.exit(0);
  `);

  try {
    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PORT: String(TEST_PORT) };
    delete env.PROSPECT_EMBEDDINGS;
    const out = execFileSync(process.execPath, [scriptPath], { env, timeout: 10000 }).toString();
    const line = out.split('\n').find((l) => l.startsWith('RESULT_JSON:'));
    assert.ok(line, `child process produced no RESULT_JSON line; full output:\n${out}`);
    return JSON.parse(line.slice('RESULT_JSON:'.length));
  } finally {
    fs.rmSync(path.dirname(scriptPath), { recursive: true, force: true });
  }
}

test('POST /api/claims (v7, job_family column present): a matching title is classified and stored, additively', () => {
  const dbPath = tmpScratchDbPath('v7-match');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    // Not a literal migration-007 check -- this just asserts we're on head schema.sql
    // (job_family present, whatever version head currently is). Read it back rather than
    // hardcode it, so the next migration doesn't re-trip this the way v8 did.
    assert.equal(setup.pragma('user_version', { simple: true }), schemaSql.match(/^PRAGMA user_version = (\d+);/)[1] * 1);
    setup.close();

    const rawPayload = JSON.stringify({ title: 'Desktop Support Technician', posted: 'today' });
    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'Acme Corp',
        role: 'Desktop Support Technician',
        description: 'Provide desktop support to end users.',
        raw_payload: rawPayload,
      },
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);

    const after = new Database(dbPath, { readonly: true });
    const row = after.prepare(
      'SELECT job_family, raw_payload, snapshot_hash FROM listings WHERE id = ?'
    ).get(result.body.listing_id);
    after.close();

    assert.equal(row.job_family, 'desktop_support');
    assert.equal(row.raw_payload, rawPayload, 'raw_payload must pass through untouched');
    assert.equal(row.snapshot_hash, crypto.createHash('sha256').update(rawPayload).digest('hex'), 'snapshot_hash must still hash raw_payload exactly as before');
  } finally {
    rmScratch(dbPath);
  }
});

test('POST /api/claims (v7, job_family column present): a no-match title stores the literal string "uncategorized", never NULL', () => {
  const dbPath = tmpScratchDbPath('v7-nomatch');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    setup.close();

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'Acme Corp',
        role: '???',
        description: 'A junk title that matches no job_family rule.',
      },
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);

    const after = new Database(dbPath, { readonly: true });
    const row = after.prepare(
      'SELECT job_family, raw_payload, snapshot_hash FROM listings WHERE id = ?'
    ).get(result.body.listing_id);
    after.close();

    assert.equal(row.job_family, 'uncategorized');
    assert.notEqual(row.job_family, null);
    assert.ok(row.snapshot_hash, 'snapshot_hash must still be computed');
  } finally {
    rmScratch(dbPath);
  }
});

test('POST /api/claims (v6, no job_family column): capture still succeeds — the boot-time feature-detect skips the column, no "no such column" error', () => {
  const dbPath = tmpScratchDbPath('v6');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(preJobFamilySchemaSql());
    assert.equal(setup.pragma('user_version', { simple: true }), 6);
    const hasCol = setup.prepare(
      "SELECT COUNT(*) AS n FROM pragma_table_info('listings') WHERE name='job_family'"
    ).get().n;
    assert.equal(hasCol, 0, 'sanity: v6 schema.sql must not have job_family yet');
    setup.close();

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'Acme Corp',
        role: 'Desktop Support Technician',
        description: 'Provide desktop support to end users.',
      },
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.ok(!JSON.stringify(result.body).match(/no such column/i));

    const after = new Database(dbPath, { readonly: true });
    const row = after.prepare('SELECT company, role FROM listings WHERE id = ?').get(result.body.listing_id);
    after.close();

    assert.equal(row.company, 'Acme Corp');
    assert.equal(row.role, 'Desktop Support Technician');
  } finally {
    rmScratch(dbPath);
  }
});
