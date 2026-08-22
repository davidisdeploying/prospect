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
const migration006Sql = fs.readFileSync(path.join(ROOT, 'migrations', '006_embedding_vec0.sql'), 'utf8');
const enrichModuleUrl = pathToFileURL(path.join(ROOT, 'server', 'enrich.js')).href;

// Derives the pre-006 (v5) schema by stripping migrations/006's, 007's AND 008's own
// additions back out of the current (already-head) schema.sql, so migrations/006
// can be exercised starting from the state it was actually written to upgrade —
// without needing a separately-maintained historical schema snapshot.
function preV6SchemaSql() {
  // Regex, not a literal version number: schema.sql's head version moves with every
  // migration (stale hardcoded "= 7" is exactly what broke this helper at v8 -- don't
  // repeat that here).
  let sql = schemaSql.replace(/^PRAGMA user_version = \d+;/, 'PRAGMA user_version = 5;');
  // migrations/013's advisor_status is now the listings tail, so it has to come off before
  // skill_extract_status can be stripped in turn — same reasoning one generation later.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  advisor_status TEXT/, '');
  // migrations/012's skill_extract_status is now the listings tail, so it has to come off
  // before llm_parse_status can be stripped in turn (same reasoning repeats one generation
  // later — see the llm_parse_status comment right below). Regex over the column and any
  // comment lines above it, so a reworded comment doesn't re-break this.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  skill_extract_status TEXT/, '');
  // migrations/010's llm_parse_status is now the listings tail, so it has to come off
  // BEFORE the literal below (which anchors on `job_family TEXT\n);`). Regex over the
  // column and any comment lines above it, so a reworded comment doesn't re-break this.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  llm_parse_status TEXT/, '');
  sql = sql.replace(
    `  apply_url TEXT,\n  -- Added by migrations/006. embedding_model is provenance for listings_vec\n  -- (below): which model produced the row's embedding, NULL until enriched.\n  embedding_model TEXT,\n  job_family TEXT\n);`,
    `  apply_url TEXT\n);`,
  );
  // migrations/024's resume_versions.body is that table's tail column, and resume_versions sits
  // near the top of schema.sql — far above the "everything from Web Push onward" truncation
  // below, which is why it needs its own strip. Anchored to the table, since `body` alone is far
  // too common a word to match safely.
  sql = sql.replace(
    /(CREATE TABLE resume_versions \([^;]*?notes      TEXT),\n(?:  --[^\n]*\n)*  body       TEXT/s,
    '$1',
  );
  // migrations/023's hunt_id is now claims' tail, so it has to come off before vendor_tracker_url
  // can be stripped in turn — same reasoning as the listings tail columns above.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  hunt_id INTEGER REFERENCES hunts\(id\)/, '');
  // migrations/023's hunts table sits above claims (claims references it), so the trailing
  // "everything from Web Push onward" truncation below cannot reach it.
  sql = sql.replace(/\n-- Hunts \(migration 023.*?CREATE INDEX idx_hunts_status ON hunts\(status\);\n/s, '');
  // migrations/009's vendor_tracker_url is claims' tail — same reasoning as llm_parse_status above.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  vendor_tracker_url TEXT/, '');
  // migrations/012 also added listing_skills.parsed_by/source_desc_hash — strip both so the
  // pre-v6 listing_skills table matches migrations/002's original three-column shape.
  sql = sql.replace(/,\n(?:  --[^\n]*\n)*  parsed_by  TEXT,\n(?:  --[^\n]*\n)*  source_desc_hash TEXT/, '');
  sql = sql.replace(
    `\n-- Embeddings (migration 006) — vec0 virtual table, populated by server/enrich.js\n-- ONLY when PROSPECT_EMBEDDINGS is enabled (default OFF). listing_id is the\n-- vec0 primary key (mirrors listings.id, not a foreign key — vec0 doesn't\n-- support REFERENCES); embedding is a 768-dim float vector from the\n-- nomic-embed-text model via Ollama's /api/embed. Never written from\n-- listings.raw_payload/snapshot_hash directly — always derived, curated text.\nCREATE VIRTUAL TABLE listings_vec USING vec0(listing_id INTEGER PRIMARY KEY, embedding FLOAT[768]);\n`,
    '',
  );
  sql = sql.replace(
    `\n-- Claim events (migration 008) — typed touchpoints (§3.4), additive + append-only, same shape as\n-- stage_transitions/claim_notes: no UPDATE/DELETE route, kind validated in code (server/validate.js\n-- ENUMS.claim_event_kind), payload is a nullable JSON TEXT column following listings.parsed's\n-- precedent. See migrations/008_claim_events.sql for the full rationale.\nCREATE TABLE claim_events (\n  id          INTEGER PRIMARY KEY,\n  claim_id    INTEGER NOT NULL REFERENCES claims(id),\n  kind        TEXT NOT NULL,\n  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),\n  due_at      TEXT,\n  payload     TEXT\n);\nCREATE INDEX idx_claim_events_claim   ON claim_events(claim_id);\nCREATE INDEX idx_claim_events_due_at  ON claim_events(due_at);`,
    '',
  );
  sql = sql.replace(
    `\n-- Resume version sends (migration 011, H16) -- append-only per-send ledger. claims.resume_version_id\n-- above stays the "current" pointer (unchanged read/patch shape); this table is what makes that\n-- pointer's history trustworthy, since PATCHing the column overwrites it with nothing recording the\n-- prior value or when a version was sent. Written by server/resumeVersionSends.js, called from the\n-- same PATCH /api/claims/:id transaction that updates claims.resume_version_id. Same insert-only\n-- shape as stage_transitions/claim_events: no UPDATE/DELETE route.\nCREATE TABLE resume_version_sends (\n  id                INTEGER PRIMARY KEY,\n  claim_id          INTEGER NOT NULL REFERENCES claims(id),\n  resume_version_id INTEGER REFERENCES resume_versions(id),\n  sent_at           TEXT NOT NULL DEFAULT (datetime('now'))\n);\nCREATE INDEX idx_resume_version_sends_claim ON resume_version_sends(claim_id);`,
    '',
  );
  // migrations/013's listing_advisories table — regex, not a literal copy (block spans several
  // prose-heavy comment lines that are easy to typo-mismatch character-for-character), anchored
  // on its unique opening comment and its own CREATE INDEX statement.
  sql = sql.replace(/\n-- Listing advisories \(migration 013.*?CREATE INDEX idx_listing_advisories_listing ON listing_advisories\(listing_id\);/s, '');
  // migrations/014's three Scout tables and indexes.
  sql = sql.replace(/\n-- Scout \(migration 014\).*?CREATE INDEX idx_scout_sightings_discovery ON scout_sightings\(discovery_id\);/s, '');
  // migrations/015's Gmail ingestion receipt table and index.
  sql = sql.replace(/\n-- Gmail ingestion receipts \(migration 015\).*?CREATE INDEX idx_scout_gmail_messages_processed\n  ON scout_gmail_messages\(processed_at DESC\);/s, '');
  sql = sql.replace(/\n-- Web Push subscriptions[\s\S]*$/s, '');
  // (line 3's header comment mentions these names in prose — check the actual
  // DDL, not incidental documentation text.)
  assert.ok(!sql.includes('CREATE VIRTUAL TABLE listings_vec'), 'preV6SchemaSql: failed to strip listings_vec DDL — string surgery is stale');
  assert.ok(!sql.includes('embedding_model TEXT'), 'preV6SchemaSql: failed to strip embedding_model column — string surgery is stale');
  assert.ok(!sql.includes('job_family'), 'preV6SchemaSql: failed to strip job_family column — string surgery is stale');
  assert.ok(!sql.includes('CREATE TABLE claim_events'), 'preV6SchemaSql: failed to strip claim_events table — string surgery is stale');
  assert.ok(!sql.includes('llm_parse_status'), 'preV6SchemaSql: failed to strip llm_parse_status column — string surgery is stale');
  assert.ok(!sql.includes('vendor_tracker_url'), 'preV6SchemaSql: failed to strip vendor_tracker_url column — string surgery is stale');
  assert.ok(!sql.includes('CREATE TABLE resume_version_sends'), 'preV6SchemaSql: failed to strip resume_version_sends table — string surgery is stale');
  assert.ok(!sql.includes('advisor_status'), 'preV6SchemaSql: failed to strip advisor_status column — string surgery is stale');
  assert.ok(!sql.includes('CREATE TABLE listing_advisories'), 'preV6SchemaSql: failed to strip listing_advisories table — string surgery is stale');
  assert.ok(!sql.includes('CREATE TABLE scout_discoveries'), 'preV6SchemaSql: failed to strip Scout tables — string surgery is stale');
  assert.ok(!sql.includes('CREATE TABLE hunts'), 'preV6SchemaSql: failed to strip hunts table — string surgery is stale');
  assert.ok(!sql.includes('hunt_id'), 'preV6SchemaSql: failed to strip hunt_id column — string surgery is stale');
  assert.ok(!/CREATE TABLE resume_versions \([^;]*body/s.test(sql), 'preV6SchemaSql: failed to strip resume_versions.body — string surgery is stale');
  return sql;
}

// Mirrors migrate.js's own execution shape (BEGIN; exec migration file; COMMIT;
// assert user_version) — this proves migrations/006's actual on-disk SQL, not
// a paraphrase of it.
function applyMigration006(db) {
  db.exec('BEGIN;');
  try {
    db.exec(migration006Sql);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    throw e;
  }
  assert.equal(db.pragma('user_version', { simple: true }), 6, 'migrations/006 must leave user_version at 6');
}

// Mirrors migrate.js's own execution shape — proves migrations/007's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/008's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/009's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/010's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/011's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/012's actual
// on-disk SQL, not a paraphrase of it.
// Mirrors migrate.js's own execution shape — proves migrations/013's actual
// on-disk SQL, not a paraphrase of it.

// Applies every migrations/NNN_*.sql with NNN > `above`, in numeric order, each in its own
// transaction and each asserted to leave user_version at its own NNN -- the same contract
// server/migrate.js enforces in production.
function applyMigrationsAbove(db, above) {
  const files = fs.readdirSync(path.join(ROOT, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({ file: f, version: Number(f.slice(0, 3)) }))
    .filter((m) => Number.isFinite(m.version) && m.version > above)
    .sort((a, b) => a.version - b.version);
  assert.ok(files.length > 0, 'no migrations found above ' + above);
  for (const { file, version } of files) {
    const sql = fs.readFileSync(path.join(ROOT, 'migrations', file), 'utf8');
    db.exec('BEGIN;');
    try {
      db.exec(sql);
      db.exec('COMMIT;');
    } catch (e) {
      db.exec('ROLLBACK;');
      throw new Error(`migrations/${file} failed: ${e.message}`);
    }
    assert.equal(
      db.pragma('user_version', { simple: true }), version,
      `migrations/${file} must leave user_version at ${version}`,
    );
  }
}

function preV6Db() {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.pragma('foreign_keys = ON');
  db.exec(preV6SchemaSql());
  return db;
}

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}

function fixedVector(seed) {
  return Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * 0.01);
}

function tmpScratchDbPath(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `prospect-embed-test-${label}-`));
  return path.join(dir, 'scratch.db');
}

function rmScratch(dbPath) {
  fs.rmSync(dbPath, { force: true });
  fs.rmSync(`${dbPath}-wal`, { force: true });
  fs.rmSync(`${dbPath}-shm`, { force: true });
  fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

test('migrations/006: applying to a v5 db creates a queryable listings_vec + embedding_model, user_version -> 6', () => {
  const db = preV6Db();
  assert.equal(db.pragma('user_version', { simple: true }), 5);
  assert.throws(() => db.prepare('SELECT * FROM listings_vec').all(), /no such table/);

  applyMigration006(db);

  assert.ok(db.pragma('table_info(listings)').some((c) => c.name === 'embedding_model'));
  const tableNames = db.prepare(`SELECT name FROM sqlite_master WHERE name LIKE 'listings_vec%'`).all().map((r) => r.name);
  assert.ok(tableNames.includes('listings_vec'), 'listings_vec virtual table missing after migration');
  // vec0 shadow tables that pragma_table_info can't see — proves the module actually loaded and built them.
  assert.ok(tableNames.some((n) => n.includes('_chunks')), 'listings_vec shadow chunks table missing');
  assert.ok(tableNames.some((n) => n.includes('_rowids')), 'listings_vec shadow rowids table missing');

  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(1), vecBuffer(fixedVector(1)));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM listings_vec').get().c, 1);

  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('schema.sql (head) is equivalent to a migrated v5 db: same sqlite_master set, same per-table columns, same vec0 shadow tables, same user_version', () => {
  const migrated = preV6Db();
  // Derived from migrations/ rather than hand-listed: this test is the proof that schema.sql and
  // the migration chain agree, and a hand-maintained list quietly stops proving that the first
  // time someone adds a migration and forgets to add a line here.
  applyMigrationsAbove(migrated, 5);

  const fresh = new Database(':memory:');
  loadVecExtension(fresh);
  fresh.pragma('foreign_keys = ON');
  fresh.exec(schemaSql);

  assert.equal(fresh.pragma('user_version', { simple: true }), migrated.pragma('user_version', { simple: true }));

  const names = (db) => db.prepare(`SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`).all();
  assert.deepEqual(names(fresh), names(migrated));

  // The name-only check above cannot see an ALTER TABLE ADD COLUMN drift (it doesn't add a
  // sqlite_master row) -- that's exactly how vendor_tracker_url/llm_parse_status went missing from
  // this file for two migrations without either failing. Compare each ordinary table's column list
  // too, so a future ADD COLUMN drift fails here instead of silently shipping.
  const ordinaryTables = names(fresh).filter((r) => r.type === 'table' && !r.name.startsWith('listings_vec'));
  for (const { name } of ordinaryTables) {
    const cols = (db) => db.prepare(`PRAGMA table_info(${name})`).all().map((c) => c.name);
    assert.deepEqual(cols(fresh), cols(migrated), `column drift on table "${name}"`);
  }

  // pragma_table_info can't see vec0's shadow tables (*_chunks/_rowids/_info/...) — PRAGMA table_list can.
  const vecTables = (db) => db.pragma('table_list').map((t) => t.name).filter((n) => n.startsWith('listings_vec')).sort();
  assert.deepEqual(vecTables(fresh), vecTables(migrated));
});

test('vec0 KNN infra smoke test: MATCH + k ordering ranks the nearest neighbor first', () => {
  const db = preV6Db();
  applyMigration006(db);

  const near = fixedVector(1);
  const far = fixedVector(99);
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(1), vecBuffer(near));
  db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(BigInt(2), vecBuffer(far));

  const rows = db.prepare(`
    SELECT listing_id, distance FROM listings_vec WHERE embedding MATCH ? AND k = 2 ORDER BY distance
  `).all(vecBuffer(near));

  assert.equal(rows.length, 2);
  assert.equal(rows[0].listing_id, 1);
  assert.equal(rows[0].distance, 0);
  assert.equal(rows[1].listing_id, 2);
  assert.ok(rows[1].distance > 0);
});

test('embedding worker: PROSPECT_EMBEDDINGS unset by default -> enqueue() is a no-op, no interval/Ollama traffic ever starts', () => {
  const dbPath = tmpScratchDbPath('off');
  try {
    const env = { ...process.env, PROSPECT_DB_PATH: dbPath };
    delete env.PROSPECT_EMBEDDINGS;
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        import { enqueue } from ${JSON.stringify(enrichModuleUrl)};
        globalThis.fetch = async () => { throw new Error('fetch must never be called when PROSPECT_EMBEDDINGS is off'); };
        enqueue(1);
        enqueue(2);
        console.log('exited-cleanly');
      `],
      { env, timeout: 5000 },
    ).toString();
    // If the interval had started, an active timer would keep the event loop
    // alive past the timeout and execFileSync would throw instead of returning.
    assert.match(out, /exited-cleanly/);
  } finally {
    rmScratch(dbPath);
  }
});

test('faithful-tracker: embedding write path never touches raw_payload/snapshot_hash (stubbed Ollama, real migration + write path)', () => {
  const dbPath = tmpScratchDbPath('faithful');
  try {
    const setup = new Database(dbPath);
    loadVecExtension(setup);
    setup.pragma('foreign_keys = ON');
    setup.exec(schemaSql); // already v6

    function seedListing(id, { company, role, description }) {
      const raw_payload = JSON.stringify({ company, role, description, source: 'Manual' });
      const snapshot_hash = crypto.createHash('sha256').update(raw_payload).digest('hex');
      setup.prepare(`
        INSERT INTO listings (id, source, raw_payload, company, role, description, snapshot_hash)
        VALUES (?, 'Manual', ?, ?, ?, ?, ?)
      `).run(id, raw_payload, company, role, description, snapshot_hash);
    }
    seedListing(1, { company: 'Acme Corp', role: 'Engineer', description: 'Build things.' });
    seedListing(2, { company: 'Globex', role: 'Analyst', description: 'Analyze things.' });

    const before = setup.prepare('SELECT id, raw_payload, snapshot_hash FROM listings ORDER BY id').all();
    const beforeMd5 = before.map((r) => crypto.createHash('md5').update(r.raw_payload).digest('hex'));
    setup.close();

    const env = { ...process.env, PROSPECT_DB_PATH: dbPath, PROSPECT_EMBEDDINGS: '1' };
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `
        globalThis.fetch = async (url, opts) => {
          console.log('FETCH_URL:' + url);
          const body = JSON.parse(opts.body);
          console.log('FETCH_INPUT:' + body.input);
          const seed = body.input.length;
          const embedding = Array.from({ length: 768 }, (_, i) => Math.sin(seed * 1000 + i) * 0.01);
          return { ok: true, json: async () => ({ embeddings: [embedding] }) };
        };
        const { embedListing } = await import(${JSON.stringify(enrichModuleUrl)});
        await embedListing(1);
        await embedListing(2);
        console.log('exited-cleanly');
        process.exit(0);
      `],
      { env, timeout: 10000 },
    ).toString();

    assert.match(out, /exited-cleanly/);
    const fetchCalls = out.split('\n').filter((l) => l.startsWith('FETCH_URL:'));
    assert.equal(fetchCalls.length, 2, 'expected exactly one /api/embed call per listing');
    for (const line of fetchCalls) {
      assert.match(line, /\/api\/embed$/, 'must call the modern /api/embed endpoint, never legacy /api/embeddings');
    }
    const inputLines = out.split('\n').filter((l) => l.startsWith('FETCH_INPUT:'));
    for (const line of inputLines) {
      assert.match(line, /^FETCH_INPUT:search_document: /, 'embed input must use the search_document: prefix');
      assert.ok(!line.includes('"source":"Manual"'), 'embed input must be curated text, not the raw_payload JSON blob');
    }

    const verify = new Database(dbPath);
    loadVecExtension(verify);
    const after = verify.prepare('SELECT id, raw_payload, snapshot_hash, enrichment_status, enriched_at, embedding_model FROM listings ORDER BY id').all();
    const afterMd5 = after.map((r) => crypto.createHash('md5').update(r.raw_payload).digest('hex'));

    assert.deepEqual(afterMd5, beforeMd5, 'raw_payload bytes must be byte-identical after embedding');
    assert.deepEqual(after.map((r) => r.snapshot_hash), before.map((r) => r.snapshot_hash), 'snapshot_hash must be unchanged after embedding');

    for (const row of after) {
      assert.equal(row.enrichment_status, 'embedded');
      assert.ok(row.enriched_at);
      assert.equal(row.embedding_model, 'nomic-embed-text');
    }

    const vecRows = verify.prepare('SELECT listing_id FROM listings_vec ORDER BY listing_id').all();
    assert.deepEqual(vecRows.map((r) => r.listing_id), [1, 2]);
    verify.close();
  } finally {
    rmScratch(dbPath);
  }
});
