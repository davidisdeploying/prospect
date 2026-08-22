// test/repost-semantic-capture.test.mjs — §5.2.3 end-to-end over the real
// POST /api/claims route (server/index.js), spawned in a child process so the
// route's module-level side effects (db.js opens a real file, index.js calls
// app.listen at import time) are isolated per test, mirroring
// test/embedding.test.mjs's child-process pattern. globalThis.fetch is stubbed
// BEFORE importing index.js so server/embed.js's embedDocument() call is fully
// controlled (never touches the real Ollama), while the test driver keeps a
// reference to the real fetch to make its own HTTP call into the spawned server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { descHash, canonicalCompanyName } from '../server/validate.js';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const schemaSql = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const indexPath = path.join(ROOT, 'server', 'index.js');

const TEST_PORT = 8799;

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}
function fixedVector(seed) {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * 0.01);
}
function perturbedVector(base, targetL2) {
  const delta = targetL2 / Math.sqrt(base.length);
  return base.map((v) => v + delta);
}

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-repost-semantic-${label}-`));
  return path.join(dir, 'scratch.db');
}

function rmScratch(dbPath) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

// Seeds a prior listing + claim (and optionally its listings_vec embedding),
// mirroring the shape POST /api/claims itself writes.
function seedPriorListing(db, { company, role, description, embeddingVector }) {
  let companyId = null;
  if (company) {
    const canon = canonicalCompanyName(company);
    const row = db.prepare(`
      INSERT INTO companies (name, canonical_name) VALUES (?, ?)
      ON CONFLICT(canonical_name) DO UPDATE SET name = excluded.name
      RETURNING id
    `).get(company, canon);
    companyId = row.id;
  }
  const info = db.prepare(`
    INSERT INTO listings (source, company, role, description, company_id, desc_hash)
    VALUES ('Manual', ?, ?, ?, ?, ?)
  `).run(company ?? null, role ?? null, description ?? null, companyId, descHash(description));
  const listingId = info.lastInsertRowid;
  const claimInfo = db.prepare(`INSERT INTO claims (listing_id, stage) VALUES (?, 'Showings')`).run(listingId);
  if (embeddingVector) {
    db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(listingId), vecBuffer(embeddingVector));
    db.prepare(`UPDATE listings SET enrichment_status = 'embedded' WHERE id = ?`).run(listingId);
  }
  return { listingId, claimId: claimInfo.lastInsertRowid };
}

// Runs POST /api/claims against a freshly-spawned server (its own child
// process) with globalThis.fetch stubbed per `fetchMode`, and returns
// {status, body, fetchCalled}.
function runCapture({ dbPath, claimBody, fetchMode, fetchVector }) {
  const scriptPath = fs.mkdtempSync(path.join(os.tmpdir(), 'prospect-repost-semantic-script-')) + '/run.mjs';
  fs.writeFileSync(scriptPath, `
    const realFetch = globalThis.fetch;
    const FETCH_MODE = ${JSON.stringify(fetchMode)};
    const FETCH_VECTOR = ${fetchVector ? JSON.stringify(fetchVector) : 'null'};
    let fetchCalled = false;
    globalThis.fetch = async (url, opts) => {
      fetchCalled = true;
      if (FETCH_MODE === 'throw') {
        throw new Error('simulated Ollama outage');
      }
      if (FETCH_MODE === 'delta') {
        return { ok: true, json: async () => ({ embeddings: [FETCH_VECTOR] }) };
      }
      throw new Error('unreachable: unexpected fetch call for FETCH_MODE=' + FETCH_MODE);
    };

    await import(${JSON.stringify('file://' + indexPath)});
    // give app.listen a tick to actually bind before we connect
    await new Promise((r) => setTimeout(r, 200));

    const res = await realFetch('http://127.0.0.1:${TEST_PORT}/api/claims', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ${JSON.stringify(JSON.stringify(claimBody))},
    });
    const body = await res.json();
    console.log('RESULT_JSON:' + JSON.stringify({ status: res.status, body, fetchCalled }));
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

test('POST /api/claims: never-blocks — a throwing/failing doc-embed still returns 201 and commits the row, with no semantic candidate', () => {
  const dbPath = tmpScratchDbPath('never-blocks');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    setup.close();

    const before = new Database(dbPath, { readonly: true });
    const listingsBefore = before.prepare('SELECT COUNT(*) c FROM listings').get().c;
    const claimsBefore = before.prepare('SELECT COUNT(*) c FROM claims').get().c;
    before.close();

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'Brand New Company',
        role: 'Totally Novel Role',
        description: 'A description that matches nothing in the corpus.',
      },
      fetchMode: 'throw',
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.repost_candidate, null, 'a failed embed must degrade to no semantic candidate, not surface a partial/garbage one');
    assert.ok(result.fetchCalled, 'sanity: the doc-embed fetch should have actually been attempted (deterministic tiers missed)');

    const after = new Database(dbPath, { readonly: true });
    assert.equal(after.prepare('SELECT COUNT(*) c FROM listings').get().c, listingsBefore + 1, 'the INSERT must still commit despite the embed failure');
    assert.equal(after.prepare('SELECT COUNT(*) c FROM claims').get().c, claimsBefore + 1);
    after.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('POST /api/claims: semantic HIT — a near-duplicate embedding yields tier semantic with the right prior_listing_id', () => {
  const dbPath = tmpScratchDbPath('semantic-hit');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    const baseVector = fixedVector(7);
    const { listingId: priorListingId } = seedPriorListing(setup, {
      company: 'Old Employer Inc',
      role: 'Warehouse Lead',
      description: 'The original posting text, long since captured.',
      embeddingVector: baseVector,
    });
    setup.close();

    const nearVector = perturbedVector(baseVector, 0.1); // well under the 0.3 threshold

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        // Deliberately a different company/role so EXACT (desc_hash) and
        // LIKELY (canonical company + title Jaccard) both miss — only the
        // semantic tier should be able to find this one.
        company: 'A Totally Different Company LLC',
        role: 'Something Else Entirely',
        description: 'A rephrased version of the original posting.',
      },
      fetchMode: 'delta',
      fetchVector: nearVector,
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.ok(result.body.repost_candidate, 'expected a semantic repost_candidate');
    assert.equal(result.body.repost_candidate.tier, 'semantic');
    assert.equal(result.body.repost_candidate.prior_listing_id, priorListingId);
    assert.ok(result.body.repost_candidate.distance <= 0.3);
  } finally {
    rmScratch(dbPath);
  }
});

test('POST /api/claims: semantic MISS — a far embedding yields no semantic candidate', () => {
  const dbPath = tmpScratchDbPath('semantic-miss');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    const baseVector = fixedVector(7);
    seedPriorListing(setup, {
      company: 'Old Employer Inc',
      role: 'Warehouse Lead',
      description: 'The original posting text, long since captured.',
      embeddingVector: baseVector,
    });
    setup.close();

    const farVector = perturbedVector(baseVector, 0.8); // well over the 0.3 threshold

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'A Totally Different Company LLC',
        role: 'Something Else Entirely',
        description: 'A genuinely unrelated posting.',
      },
      fetchMode: 'delta',
      fetchVector: farVector,
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.repost_candidate, null);
    assert.ok(result.fetchCalled, 'sanity: the doc-embed fetch should have actually been attempted');
  } finally {
    rmScratch(dbPath);
  }
});

test('POST /api/claims: deterministic EXACT hit short-circuits — the semantic tier never fires (no embed call), tier stays exact', () => {
  const dbPath = tmpScratchDbPath('deterministic-gate');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    const repeatedDescription = 'This exact description text will repeat verbatim.';
    const { listingId: priorListingId } = seedPriorListing(setup, {
      company: 'Old Employer Inc',
      role: 'Warehouse Lead',
      description: repeatedDescription,
    });
    setup.close();

    const result = runCapture({
      dbPath,
      claimBody: {
        source: 'Manual',
        company: 'Old Employer Inc',
        role: 'Warehouse Lead',
        description: repeatedDescription, // identical -> desc_hash EXACT match
      },
      // If the semantic branch were reached despite the EXACT hit, this fetch
      // stub would throw and the test's fetchCalled assertion below would catch it.
      fetchMode: 'throw',
    });

    assert.equal(result.status, 201, `expected 201, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert.ok(result.body.repost_candidate, 'expected a repost_candidate');
    assert.equal(result.body.repost_candidate.tier, 'exact');
    assert.equal(result.body.repost_candidate.prior_listing_id, priorListingId);
    assert.equal(result.fetchCalled, false, 'the doc-embed must never be called when a deterministic tier already hit');
  } finally {
    rmScratch(dbPath);
  }
});
