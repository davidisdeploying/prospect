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
const adviseModuleUrl = pathToFileURL(path.join(ROOT, 'server', 'advise.js')).href;

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-advise-test-${label}-`));
  return path.join(dir, 'scratch.db');
}

function rmScratch(dbPath) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

function descHash(description) {
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

test('advise worker: PROSPECT_ADVISOR unset by default -> enqueue() is a no-op, no interval/Ollama traffic ever starts', () => {
  const dbPath = tmpScratchDbPath('off');
  try {
    const env = { ...process.env, PROSPECT_DB_PATH: dbPath };
    delete env.PROSPECT_ADVISOR;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import { enqueue } from ${JSON.stringify(adviseModuleUrl)};
        globalThis.fetch = async () => { throw new Error('fetch must never be called when PROSPECT_ADVISOR is off'); };
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

test('faithful-tracker + happy path: writes an INSERT-only listing_advisories row, feeds description+parsed (never raw_payload), never touches raw_payload/description/role_family/job_family/other status columns', () => {
  const dbPath = tmpScratchDbPath('faithful');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Senior Widget Engineer. Salary: competitive. Duties: file tickets, reset passwords.';
    const dHash = descHash(description);
    seedListing(setup, 1, {
      company: 'Acme Corp', role: 'Senior Widget Engineer', description,
      parsed: JSON.stringify({ parsed_by: 'adapter', benefits: ['Health insurance'] }),
    });

    const before = setup.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family FROM listings ORDER BY id').all();
    const beforeMd5 = crypto.createHash('md5').update(before[0].raw_payload).digest('hex');
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async (url, opts) => {
          console.log('FETCH_URL:' + url);
          const body = JSON.parse(opts.body);
          console.log('FETCH_MODEL:' + body.model);
          console.log('FETCH_FORMAT:' + body.format);
          console.log('FETCH_USER_CONTENT_START:' + body.messages[1].content.slice(0, 200));
          return {
            ok: true,
            json: async () => ({
              message: { role: 'assistant', content: JSON.stringify({
                comp_assessment: 'Salary described only as "competitive" with no range given.',
                seniority_assessment: 'Titled Senior but duties describe entry-level ticket triage.',
                repost_assessment: null,
                questions: ['What does the salary range actually look like?', 42, null],
              }) },
              done: true,
            }),
          };
        };
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
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
    assert.match(out, /FETCH_USER_CONTENT_START:DESCRIPTION:\nSenior Widget Engineer\./, 'must feed the curated description');
    assert.match(out, /PARSED DATA \(JSON\)/, 'must also feed the parsed long tail alongside the description');
    assert.ok(!out.includes('"source":"Manual"'), 'prompt input must never include raw_payload');

    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family, enrichment_status, llm_parse_status, skill_extract_status, advisor_status, parsed FROM listings WHERE id = 1').get();
    const afterMd5 = crypto.createHash('md5').update(after.raw_payload).digest('hex');

    assert.equal(afterMd5, beforeMd5, 'raw_payload bytes must be byte-identical after advising');
    assert.equal(after.snapshot_hash, before[0].snapshot_hash);
    assert.equal(after.description, before[0].description);
    assert.equal(after.role_family, before[0].role_family, 'role_family must stay untouched (locked deterministic)');
    assert.equal(after.job_family, before[0].job_family, 'job_family must stay untouched (locked deterministic)');
    assert.equal(after.advisor_status, 'generated', 'success must land a terminal value in this worker\'s OWN column');
    assert.equal(after.llm_parse_status, null, 'advise must never write llm-parse\'s column');
    assert.equal(after.skill_extract_status, null, 'advise must never write skill-extract\'s column');
    assert.equal(after.enrichment_status, 'raw', 'advise must never write enrich.js\'s column either');
    assert.deepEqual(JSON.parse(after.parsed), { parsed_by: 'adapter', benefits: ['Health insurance'] }, 'listings.parsed must be byte-for-byte untouched — advisor output lives ONLY in listing_advisories, never folded into parsed');

    const rows = verify.prepare('SELECT listing_id, desc_hash, model, advisory FROM listing_advisories WHERE listing_id = 1').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].desc_hash, dHash);
    assert.equal(rows[0].model, 'gpt-oss:20b');
    const advisory = JSON.parse(rows[0].advisory);
    assert.equal(advisory.comp_assessment, 'Salary described only as "competitive" with no range given.');
    assert.equal(advisory.seniority_assessment, 'Titled Senior but duties describe entry-level ticket triage.');
    assert.equal(advisory.repost_assessment, null);
    assert.deepEqual(advisory.questions, ['What does the salary range actually look like?'], 'non-string question entries must be dropped, never coerced');

    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('idempotency: a listing whose latest stored advisory desc_hash already matches the current desc_hash is skipped (no fetch)', () => {
  const dbPath = tmpScratchDbPath('idempotent');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Widely scoped role.';
    const dHash = descHash(description);
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description, parsed: null });
    setup.prepare(`INSERT INTO listing_advisories (listing_id, desc_hash, model, advisory) VALUES (1, ?, 'gpt-oss:20b', ?)`)
      .run(dHash, JSON.stringify({ comp_assessment: null, seniority_assessment: null, repost_assessment: null, questions: [] }));
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called for an already-advised, unchanged listing'); };
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT advisor_status FROM listings WHERE id = 1').get();
    assert.equal(after.advisor_status, 'generated', 'an already-advised unchanged row IS generated — it must re-assert that, not degrade itself');
    const rows = verify.prepare('SELECT count(*) c FROM listing_advisories WHERE listing_id = 1').get().c;
    assert.equal(rows, 1, 'a no-op idempotency check must not insert a duplicate row');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('append-only history: a re-survey (changed desc_hash) INSERTs a new generation, never overwrites or deletes the prior one', () => {
  const dbPath = tmpScratchDbPath('append-only');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const oldDescription = 'Build things. Requires SQL.';
    const newDescription = 'Build things. Requires SQL and Python now.';
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description: newDescription, parsed: null });
    setup.prepare(`INSERT INTO listing_advisories (listing_id, desc_hash, model, advisory) VALUES (1, ?, 'gpt-oss:20b', ?)`)
      .run(descHash(oldDescription), JSON.stringify({ comp_assessment: 'old note', seniority_assessment: null, repost_assessment: null, questions: [] }));
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => ({ message: { content: JSON.stringify({ comp_assessment: 'new note', seniority_assessment: null, repost_assessment: null, questions: [] }) } }),
        });
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
        process.exit(0);
      `],
      { env, timeout: 10000 },
    );

    const verify = new Database(dbPath);
    const rows = verify.prepare('SELECT desc_hash, advisory FROM listing_advisories WHERE listing_id = 1 ORDER BY id').all();
    assert.equal(rows.length, 2, 'the prior generation must survive; a re-survey INSERTs, never UPDATEs/DELETEs');
    assert.equal(rows[0].desc_hash, descHash(oldDescription));
    assert.equal(JSON.parse(rows[0].advisory).comp_assessment, 'old note');
    assert.equal(rows[1].desc_hash, descHash(newDescription));
    assert.equal(JSON.parse(rows[1].advisory).comp_assessment, 'new note');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('no description yet: a listing with no description is marked skipped, no fetch call', () => {
  const dbPath = tmpScratchDbPath('nodesc');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description: null, parsed: null });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called when description is null'); };
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT advisor_status FROM listings WHERE id = 1').get();
    assert.equal(after.advisor_status, 'skipped');
    const rows = verify.prepare('SELECT count(*) c FROM listing_advisories WHERE listing_id = 1').get().c;
    assert.equal(rows, 0);
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
    const description = 'Build things. Requires SQL.';
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description, parsed: null });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: { content: 'not json at all' } }) });
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/, 'a malformed model response must never crash the worker');
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT advisor_status FROM listings WHERE id = 1').get();
    assert.equal(after.advisor_status, 'failed', 'an advisor failure gets ITS OWN failure signal');
    const rows = verify.prepare('SELECT count(*) c FROM listing_advisories WHERE listing_id = 1').get().c;
    assert.equal(rows, 0, 'a failed generation must not write a partial listing_advisories row');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('degrade-on-failure: an unparseable listings.parsed column refuses to guess and marks failed, without ever calling fetch', () => {
  const dbPath = tmpScratchDbPath('badparsed');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    const description = 'Build things.';
    seedListing(setup, 1, { company: 'Acme', role: 'Engineer', description, parsed: 'not valid json' });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_ADVISOR: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called when parsed is unparseable'); };
        const { adviseListing } = await import(${JSON.stringify(adviseModuleUrl)});
        await adviseListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT advisor_status FROM listings WHERE id = 1').get();
    assert.equal(after.advisor_status, 'failed');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});
