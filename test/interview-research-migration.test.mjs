import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/032_interview_research_jobs.sql'), 'utf8');

function v31Schema() {
  return schema
    .replace('PRAGMA user_version = 32;', 'PRAGMA user_version = 31;')
    .replace('  completed_at TEXT,\n  provider_error TEXT\n', '  completed_at TEXT\n')
    .replace(/\n-- Agent-backed interview research \(migration 032\)[\s\S]*$/, '\n');
}

test('migration 032 adds an empty durable research queue without changing preparations', () => {
  const database = new Database(':memory:'); loadVecExtension(database); database.pragma('foreign_keys = ON'); database.exec(v31Schema());
  database.prepare("INSERT INTO listings (id, source, company, role) VALUES (1, 'test', 'Example', 'Technician')").run();
  database.prepare("INSERT INTO claims (id, listing_id, stage) VALUES (1, 1, 'Staked')").run();
  database.prepare("INSERT INTO resume_versions (id,label,body) VALUES (1,'Baseline','source')").run();
  database.prepare(`INSERT INTO interview_preparations
    (id,request_key,source_input_hash,claim_id,listing_id,listing_snapshot_generation,listing_snapshot_hash,
     resume_version_id,career_claims_sha256,career_claims_schema_version,interview_kind,prompt_version,deterministic_json,status)
    VALUES (1,'request','source',1,1,1,'listing',1,?,1,'recruiter_screen','interview-prep-v1','{}','ready')`).run('a'.repeat(64));
  const before = database.prepare('SELECT * FROM interview_preparations WHERE id=1').get();
  database.exec(migration);
  assert.equal(database.pragma('user_version', { simple: true }), 32);
  assert.deepEqual(database.prepare('SELECT id,request_key,source_input_hash,claim_id,status FROM interview_preparations WHERE id=1').get(), {
    id: before.id, request_key: before.request_key, source_input_hash: before.source_input_hash, claim_id: before.claim_id, status: before.status,
  });
  assert.equal(database.prepare('SELECT provider_error FROM interview_preparations WHERE id=1').get().provider_error, null);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM interview_research_jobs').get().n, 0);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  database.close();
});

test('fresh and migrated schemas expose identical research columns', () => {
  const fresh = new Database(':memory:'); loadVecExtension(fresh); fresh.exec(schema);
  const migrated = new Database(':memory:'); loadVecExtension(migrated); migrated.exec(v31Schema()); migrated.exec(migration);
  for (const table of ['interview_preparations', 'interview_research_jobs']) {
    assert.deepEqual(
      migrated.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      fresh.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      table,
    );
  }
  fresh.close(); migrated.close();
});
