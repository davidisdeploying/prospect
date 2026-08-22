import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';

import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const schemaSql = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const llmParseModuleUrl = pathToFileURL(path.join(ROOT, 'server', 'llmParse.js')).href;

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-llmparse-test-${label}-`));
  return path.join(dir, 'scratch.db');
}

function rmScratch(dbPath) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

function descHash(description) {
  // Mirrors server/validate.js's descHash normalization closely enough for these
  // fixtures (no LinkedIn go-wrapper `mt=` tokens in the test descriptions).
  const norm = String(description).trim().replace(/\s+/g, ' ').toLowerCase();
  return crypto.createHash('sha256').update(norm).digest('hex');
}

function seedListing(db, id, { company, role, description, parsed }) {
  const raw_payload = JSON.stringify({ company, role, description, source: 'Manual' });
  const snapshot_hash = crypto.createHash('sha256').update(raw_payload).digest('hex');
  db.prepare(`
    INSERT INTO listings (id, source, raw_payload, company, role, description, snapshot_hash, desc_hash, parsed)
    VALUES (?, 'Manual', ?, ?, ?, ?, ?, ?, ?)
  `).run(id, raw_payload, company, role, description, snapshot_hash, description ? descHash(description) : null, parsed ?? null);
}

test('llm-parse worker: PROSPECT_LLM_PARSE unset by default -> enqueue() is a no-op, no interval/Ollama traffic ever starts', () => {
  const dbPath = tmpScratchDbPath('off');
  try {
    const env = { ...process.env, PROSPECT_DB_PATH: dbPath };
    delete env.PROSPECT_LLM_PARSE;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import { enqueue } from ${JSON.stringify(llmParseModuleUrl)};
        globalThis.fetch = async () => { throw new Error('fetch must never be called when PROSPECT_LLM_PARSE is off'); };
        enqueue(1);
        enqueue(2);
        console.log('exited-cleanly');
      `],
      { env, timeout: 5000 },
    ).toString();
    assert.match(out, /exited-cleanly/);
  } finally {
    rmScratch(dbPath);
  }
});

test('faithful-tracker: llm-parse write path never touches raw_payload/snapshot_hash/description, and never touches role_family/job_family (stubbed Ollama)', () => {
  const dbPath = tmpScratchDbPath('faithful');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    seedListing(setup, 1, {
      company: 'Acme Corp', role: 'Engineer',
      description: 'Build things. Requires SQL and JavaScript. Pay: $100k-$140k.',
      parsed: JSON.stringify({ parsed_by: 'adapter', sections: { Overview: 'Build things.' } }),
    });

    const before = setup.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family FROM listings ORDER BY id').all();
    const beforeMd5 = before.map((r) => crypto.createHash('md5').update(r.raw_payload).digest('hex'));
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_LLM_PARSE: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async (url, opts) => {
          console.log('FETCH_URL:' + url);
          const body = JSON.parse(opts.body);
          console.log('FETCH_MODEL:' + body.model);
          console.log('FETCH_FORMAT:' + body.format);
          console.log('FETCH_USER_CONTENT:' + body.messages[1].content);
          return {
            ok: true,
            json: async () => ({
              message: { role: 'assistant', content: JSON.stringify({
                sections: { Requirements: 'SQL, JavaScript' },
                skills_prose: 'SQL and JavaScript',
                comp_prose: 'One hundred to one hundred forty thousand',
                role_hint: 'engineering',
              }) },
              done: true,
            }),
          };
        };
        const { llmParseListing } = await import(${JSON.stringify(llmParseModuleUrl)});
        await llmParseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 10000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const fetchCalls = out.split('\n').filter((l) => l.startsWith('FETCH_URL:'));
    assert.equal(fetchCalls.length, 1, 'expected exactly one /api/chat call');
    assert.match(fetchCalls[0], /\/api\/chat$/, 'must call the chat/completion endpoint, never the embed endpoint');
    assert.match(out, /FETCH_MODEL:gpt-oss:20b/);
    assert.match(out, /FETCH_FORMAT:json/, 'must request strict JSON output');
    assert.match(out, /FETCH_USER_CONTENT:Build things\./, 'must feed the curated description, not raw_payload');
    assert.ok(!out.includes('"source":"Manual"'), 'prompt input must be curated description text, not the raw_payload JSON blob');

    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family, enrichment_status, llm_parse_status, parsed FROM listings WHERE id = 1').get();
    const afterMd5 = crypto.createHash('md5').update(after.raw_payload).digest('hex');

    assert.equal(afterMd5, beforeMd5[0], 'raw_payload bytes must be byte-identical after llm-parse');
    assert.equal(after.snapshot_hash, before[0].snapshot_hash);
    assert.equal(after.description, before[0].description);
    assert.equal(after.role_family, before[0].role_family, 'role_family must stay untouched (locked deterministic)');
    assert.equal(after.job_family, before[0].job_family, 'job_family must stay untouched (locked deterministic)');
    assert.equal(after.llm_parse_status, 'parsed', 'success must land a terminal value in this worker\'s OWN column');
    assert.equal(after.enrichment_status, 'raw', 'enrichment_status belongs to enrich.js — llm-parse must never write it');

    const parsed = JSON.parse(after.parsed);
    assert.equal(parsed.parsed_by, 'adapter', 'adapter provenance tag must survive untouched');
    assert.deepEqual(parsed.sections, { Overview: 'Build things.' }, 'adapter top-level sections must survive untouched');
    assert.ok(parsed.llm_parse, 'llm_parse namespace must be present');
    assert.deepEqual(parsed.llm_parse.sections, { Requirements: 'SQL, JavaScript' });
    assert.equal(parsed.llm_parse.skills_prose, 'SQL and JavaScript');
    assert.equal(parsed.llm_parse.comp_prose, 'One hundred to one hundred forty thousand');
    assert.equal(parsed.llm_parse.role_hint, 'engineering');
    assert.equal(parsed.llm_parse.model, 'gpt-oss:20b');
    assert.equal(parsed.llm_parse.desc_hash, descHash(before[0].description));
    assert.ok(parsed.llm_parse.generated_at);

    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('idempotency: a listing whose llm_parse.desc_hash already matches the current desc_hash is skipped (no fetch call)', () => {
  const dbPath = tmpScratchDbPath('idempotent');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Requires SQL.';
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({
        parsed_by: 'adapter',
        llm_parse: { sections: {}, skills_prose: 'SQL', comp_prose: null, role_hint: 'engineering', desc_hash: descHash(description), generated_at: '2026-01-01T00:00:00.000Z', model: 'gpt-oss:20b' },
      }),
    });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_LLM_PARSE: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called for an already-llm-parsed, unchanged listing'); };
        const { llmParseListing } = await import(${JSON.stringify(llmParseModuleUrl)});
        await llmParseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT enrichment_status, llm_parse_status FROM listings WHERE id = 1').get();
    assert.equal(after.llm_parse_status, 'parsed', 'an already-parsed unchanged row IS parsed — it must re-assert that, not degrade itself');
    assert.equal(after.enrichment_status, 'raw', 'the no-op path must not touch enrich.js\'s column either');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('degrade-on-failure: non-JSON model output marks the listing failed and never throws out of the worker', () => {
  const dbPath = tmpScratchDbPath('malformed');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description: 'Build things.' });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_LLM_PARSE: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: { content: 'not json at all' } }) });
        const { llmParseListing } = await import(${JSON.stringify(llmParseModuleUrl)});
        await llmParseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/, 'a malformed model response must never crash the worker');
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT enrichment_status, llm_parse_status, parsed FROM listings WHERE id = 1').get();
    assert.equal(after.llm_parse_status, 'failed', 'an llm-parse failure gets ITS OWN failure signal');
    assert.equal(after.enrichment_status, 'raw', 'an llm-parse failure must NOT masquerade as an embedding failure');
    assert.equal(after.parsed, null, 'a failed parse must not write a partial/garbage llm_parse payload');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

// The regression this whole change exists to prevent. Before migrations/010, llm-parse
// borrowed enrichment_status, so an ALREADY-EMBEDDED row that llm-parse merely re-visited
// got its 'embedded' overwritten — and enrich.js's boot backfill (`WHERE enrichment_status
// != 'embedded'`) then re-embedded it on the next restart, burning real Ollama/GPU work on
// charlie for nothing. 9 of 15 live rows were in exactly that state when this was found.
test('cross-worker non-interference: llm-parse must never degrade an already-embedded row\'s enrichment_status', () => {
  const dbPath = tmpScratchDbPath('nointerfere');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Requires SQL.';
    // Two rows enrich.js has already finished with, in its two terminal states.
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({
        parsed_by: 'adapter',
        llm_parse: { sections: {}, skills_prose: 'SQL', comp_prose: null, role_hint: 'engineering', desc_hash: descHash(description), generated_at: '2026-01-01T00:00:00.000Z', model: 'gpt-oss:20b' },
      }),
    });
    seedListing(setup, 2, { company: 'Beta', role: 'Analyst', description: null });
    setup.prepare("UPDATE listings SET enrichment_status = 'embedded', embedding_model = 'nomic-embed-text' WHERE id = 1").run();
    setup.prepare("UPDATE listings SET enrichment_status = 'embedded', embedding_model = 'nomic-embed-text' WHERE id = 2").run();
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_LLM_PARSE: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('no fetch expected: row 1 is already parsed, row 2 has no description'); };
        const { llmParseListing } = await import(${JSON.stringify(llmParseModuleUrl)});
        await llmParseListing(1);
        await llmParseListing(2);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const rows = verify.prepare('SELECT id, enrichment_status, llm_parse_status FROM listings ORDER BY id').all();
    assert.equal(rows[0].enrichment_status, 'embedded', 'the already-parsed path must leave embedded intact');
    assert.equal(rows[1].enrichment_status, 'embedded', 'the no-description path must leave embedded intact');
    assert.equal(rows[0].llm_parse_status, 'parsed');
    assert.equal(rows[1].llm_parse_status, 'skipped');
    // The actual cost of the old collision: enrich.js's boot backfill selector.
    const wouldReEmbed = verify.prepare("SELECT count(*) c FROM listings WHERE enrichment_status != 'embedded'").get().c;
    assert.equal(wouldReEmbed, 0, 'no row may be handed back to enrich.js for a needless re-embed');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});
