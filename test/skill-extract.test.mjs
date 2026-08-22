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
const skillExtractModuleUrl = pathToFileURL(path.join(ROOT, 'server', 'skillExtract.js')).href;

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-skillextract-test-${label}-`));
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

function withLlmParse(descriptionHash, { skills_prose = null, role_hint = 'engineering' } = {}) {
  return {
    sections: {}, skills_prose, comp_prose: null, role_hint,
    desc_hash: descriptionHash, generated_at: '2026-01-01T00:00:00.000Z', model: 'gpt-oss:20b',
  };
}

test('skill-extract worker: PROSPECT_SKILL_EXTRACT unset by default -> enqueue() is a no-op, no interval/Ollama traffic ever starts', () => {
  const dbPath = tmpScratchDbPath('off');
  try {
    const env = { ...process.env, PROSPECT_DB_PATH: dbPath };
    delete env.PROSPECT_SKILL_EXTRACT;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import { enqueue } from ${JSON.stringify(skillExtractModuleUrl)};
        globalThis.fetch = async () => { throw new Error('fetch must never be called when PROSPECT_SKILL_EXTRACT is off'); };
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

test('faithful-tracker + happy path: writes listing_skills tagged parsed_by=llm, respects the tier enum, never touches raw_payload/description/role_family/job_family (stubbed Ollama)', () => {
  const dbPath = tmpScratchDbPath('faithful');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Requires SQL and JavaScript. Docker is a plus. Pay: $100k-$140k.';
    const dHash = descHash(description);
    seedListing(setup, 1, {
      company: 'Acme Corp', role: 'Engineer', description,
      parsed: JSON.stringify({
        parsed_by: 'adapter',
        llm_parse: withLlmParse(dHash, { skills_prose: 'Requires SQL and JavaScript. Docker is a plus.' }),
      }),
    });

    const before = setup.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family FROM listings ORDER BY id').all();
    const beforeMd5 = crypto.createHash('md5').update(before[0].raw_payload).digest('hex');
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_SKILL_EXTRACT: '1' };
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
                skills: [
                  { skill: 'SQL', tier: 'required' },
                  { skill: 'JavaScript', tier: 'required' },
                  { skill: 'Docker', tier: 'preferred' },
                  { skill: 'Ambiguous Thing', tier: 'other' },
                  { skill: 'Unstated Thing' },
                ],
              }) },
              done: true,
            }),
          };
        };
        const { extractSkillsForListing } = await import(${JSON.stringify(skillExtractModuleUrl)});
        await extractSkillsForListing(1);
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
    assert.match(out, /FETCH_USER_CONTENT:Requires SQL and JavaScript\. Docker is a plus\./, 'must feed skills_prose, not the raw description');
    assert.ok(!out.includes('Build things.'), 'prompt input must be skills_prose, never the full description');

    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT id, raw_payload, snapshot_hash, description, role_family, job_family, enrichment_status, llm_parse_status, skill_extract_status, parsed FROM listings WHERE id = 1').get();
    const afterMd5 = crypto.createHash('md5').update(after.raw_payload).digest('hex');

    assert.equal(afterMd5, beforeMd5, 'raw_payload bytes must be byte-identical after skill-extract');
    assert.equal(after.snapshot_hash, before[0].snapshot_hash);
    assert.equal(after.description, before[0].description);
    assert.equal(after.role_family, before[0].role_family, 'role_family must stay untouched (locked deterministic)');
    assert.equal(after.job_family, before[0].job_family, 'job_family must stay untouched (locked deterministic)');
    assert.equal(after.skill_extract_status, 'extracted', 'success must land a terminal value in this worker\'s OWN column');
    assert.equal(after.llm_parse_status, null, 'skill-extract must never write llm-parse\'s column');
    assert.equal(after.enrichment_status, 'raw', 'skill-extract must never write enrich.js\'s column either');

    const parsed = JSON.parse(after.parsed);
    assert.equal(parsed.parsed_by, 'adapter', 'adapter provenance tag must survive untouched');
    assert.ok(parsed.llm_parse, 'llm_parse namespace must survive untouched');
    assert.ok(parsed.skill_extract, 'skill_extract namespace must be present');
    assert.equal(parsed.skill_extract.desc_hash, dHash);
    assert.equal(parsed.skill_extract.model, 'gpt-oss:20b');
    assert.equal(parsed.skill_extract.skill_count, 5);

    const skills = verify.prepare('SELECT skill, tier, parsed_by, source_desc_hash FROM listing_skills WHERE listing_id = 1 ORDER BY id').all();
    assert.equal(skills.length, 5);
    assert.deepEqual(skills.map(s => [s.skill, s.tier]), [
      ['SQL', 'required'],
      ['JavaScript', 'required'],
      ['Docker', 'preferred'],
      ['Ambiguous Thing', null],
      ['Unstated Thing', null],
    ], 'an invalid/absent tier must degrade to null, never be guessed — no other-catch-all');
    for (const s of skills) {
      assert.equal(s.parsed_by, 'llm');
      assert.equal(s.source_desc_hash, dHash);
    }

    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('idempotency: a listing whose skill_extract.desc_hash already matches llm_parse.desc_hash is skipped (no fetch call)', () => {
  const dbPath = tmpScratchDbPath('idempotent');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Requires SQL.';
    const dHash = descHash(description);
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({
        parsed_by: 'adapter',
        llm_parse: withLlmParse(dHash, { skills_prose: 'Requires SQL.' }),
        skill_extract: { desc_hash: dHash, skill_count: 1, generated_at: '2026-01-01T00:00:00.000Z', model: 'gpt-oss:20b' },
      }),
    });
    setup.prepare(`INSERT INTO listing_skills (listing_id, skill, tier, parsed_by, source_desc_hash) VALUES (1, 'SQL', 'required', 'llm', ?)`).run(dHash);
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_SKILL_EXTRACT: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called for an already-extracted, unchanged listing'); };
        const { extractSkillsForListing } = await import(${JSON.stringify(skillExtractModuleUrl)});
        await extractSkillsForListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT skill_extract_status FROM listings WHERE id = 1').get();
    assert.equal(after.skill_extract_status, 'extracted', 'an already-extracted unchanged row IS extracted — it must re-assert that, not degrade itself');
    const skills = verify.prepare('SELECT count(*) c FROM listing_skills WHERE listing_id = 1').get().c;
    assert.equal(skills, 1, 'a no-op idempotency check must not touch existing rows');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

test('no skills_prose yet: a listing with llm_parse but no skills_prose is marked skipped, no fetch call', () => {
  const dbPath = tmpScratchDbPath('noprose');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);
    const description = 'Build things.';
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({ parsed_by: 'adapter', llm_parse: withLlmParse(descHash(description), { skills_prose: null }) }),
    });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_SKILL_EXTRACT: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => { throw new Error('fetch must never be called when skills_prose is null'); };
        const { extractSkillsForListing } = await import(${JSON.stringify(skillExtractModuleUrl)});
        await extractSkillsForListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT skill_extract_status FROM listings WHERE id = 1').get();
    assert.equal(after.skill_extract_status, 'skipped');
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
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({ parsed_by: 'adapter', llm_parse: withLlmParse(descHash(description), { skills_prose: 'Requires SQL.' }) }),
    });
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_SKILL_EXTRACT: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => ({ ok: true, json: async () => ({ message: { content: 'not json at all' } }) });
        const { extractSkillsForListing } = await import(${JSON.stringify(skillExtractModuleUrl)});
        await extractSkillsForListing(1);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 5000 },
    ).toString();

    assert.match(out, /exited-cleanly/, 'a malformed model response must never crash the worker');
    const verify = new Database(dbPath);
    const after = verify.prepare('SELECT skill_extract_status, parsed FROM listings WHERE id = 1').get();
    assert.equal(after.skill_extract_status, 'failed', 'a skill-extract failure gets ITS OWN failure signal');
    const skills = verify.prepare('SELECT count(*) c FROM listing_skills WHERE listing_id = 1').get().c;
    assert.equal(skills, 0, 'a failed extraction must not write partial/garbage listing_skills rows');
    const parsed = JSON.parse(after.parsed);
    assert.ok(!parsed.skill_extract, 'a failed extraction must not write a partial skill_extract namespace');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});

// The specific invariant this build introduces that llm-parse never needed: listing_skills has
// NO per-listing uniqueness in the schema, and the manual/adapter capture path (server/index.js)
// already writes rows here with parsed_by NULL. A re-run's delete-then-insert MUST be scoped to
// this worker's own parsed_by='llm' rows only, or it would silently destroy a human-entered or
// adapter-scraped skill on every re-survey.
test('provenance guard: re-extraction never deletes or touches a parsed_by IS NULL (adapter/manual) listing_skills row for the same listing', () => {
  const dbPath = tmpScratchDbPath('provenance');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql);

    const description = 'Build things. Requires SQL and Python.';
    const dHash = descHash(description);
    seedListing(setup, 1, {
      company: 'Acme', role: 'Engineer', description,
      parsed: JSON.stringify({ parsed_by: 'adapter', llm_parse: withLlmParse(dHash, { skills_prose: 'Requires SQL and Python.' }) }),
    });
    // A pre-existing manually entered skill row — no LLM has ever touched this listing.
    setup.prepare(`INSERT INTO listing_skills (listing_id, skill, tier) VALUES (1, 'Excel', 'preferred')`).run();
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_SKILL_EXTRACT: '1' };
    execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async () => ({
          ok: true,
          json: async () => ({ message: { content: JSON.stringify({ skills: [{ skill: 'SQL', tier: 'required' }, { skill: 'Python', tier: 'required' }] }) } }),
        });
        const { extractSkillsForListing } = await import(${JSON.stringify(skillExtractModuleUrl)});
        await extractSkillsForListing(1);
        process.exit(0);
      `],
      { env, timeout: 10000 },
    );

    const verify = new Database(dbPath);
    const rows = verify.prepare('SELECT skill, tier, parsed_by FROM listing_skills WHERE listing_id = 1 ORDER BY parsed_by IS NULL DESC, id').all();
    assert.deepEqual(rows, [
      { skill: 'Excel', tier: 'preferred', parsed_by: null },
      { skill: 'SQL', tier: 'required', parsed_by: 'llm' },
      { skill: 'Python', tier: 'required', parsed_by: 'llm' },
    ], 'the manual Excel row must survive untouched alongside the two fresh LLM rows');
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});
