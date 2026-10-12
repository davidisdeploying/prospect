import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/028_application_packages.sql'), 'utf8');
const migration29 = fs.readFileSync(path.join(root, 'migrations/029_application_generation_queue.sql'), 'utf8');

function v27Schema() {
  return schema
    .replace('PRAGMA user_version = 28;', 'PRAGMA user_version = 27;')
    .replace(/,\n  -- Added by migration 028[\s\S]*?audit_json\s+TEXT\n\);/, '\n);')
    .replace(/\n-- Application packages \(migration 028\)[\s\S]*?CREATE INDEX idx_application_package_events_package ON application_package_events\(package_id, id\);\n/, '\n');
}

function v28Schema() {
  return schema
    .replace('PRAGMA user_version = 29;', 'PRAGMA user_version = 28;')
    .replace(",\n  synthesis_status   TEXT NOT NULL DEFAULT 'not_requested',\n  synthesis_error    TEXT,\n  synthesis_completed_at TEXT", '')
    .replace(/\n-- Durable application generation queue \(migration 029\)[\s\S]*$/, '\n');
}

test('migration 028 upgrades schema 27 without altering existing resume data', () => {
  const database = new Database(':memory:');
  loadVecExtension(database);
  database.exec(v27Schema());
  database.prepare("INSERT INTO resume_versions (label, notes, body) VALUES ('Legacy', 'kept', 'private body')").run();
  database.exec(migration);
  assert.equal(database.pragma('user_version', { simple: true }), 28);
  const legacy = database.prepare('SELECT * FROM resume_versions').get();
  assert.equal(legacy.label, 'Legacy');
  assert.equal(legacy.kind, null);
  assert.ok(database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='application_packages'").get());
  database.close();
});

test('fresh schema and migrated schema expose the same v28 application-package columns', () => {
  const fresh = new Database(':memory:'); loadVecExtension(fresh); fresh.exec(schema);
  const migrated = new Database(':memory:'); loadVecExtension(migrated); migrated.exec(v27Schema()); migrated.exec(migration);
  for (const table of ['resume_versions', 'application_packages', 'application_package_artifacts', 'application_package_events']) {
    assert.deepEqual(
      migrated.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      fresh.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      table,
    );
  }
  fresh.close(); migrated.close();
});

test('migration 029 preserves rows, separates enrichment failure, and creates no backfill jobs', () => {
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(v28Schema());
  database.prepare("INSERT INTO listings (id, source, company, role) VALUES (1, 'test', 'Example', 'Tech')").run();
  database.prepare("INSERT INTO claims (id, listing_id, stage) VALUES (1, 1, 'Staked')").run();
  database.prepare(`INSERT INTO job_listing_audits
    (id, listing_id, claim_id, listing_desc_hash, career_source_path, career_claims_hash,
     prompt_version, input_hash, status, deterministic_json, error, completed_at)
    VALUES (1,1,1,'desc','career','career-hash','v1','input','failed','{}','model offline',datetime('now'))`).run();
  database.exec(migration29);
  assert.equal(database.pragma('user_version', { simple: true }), 29);
  const audit = database.prepare('SELECT * FROM job_listing_audits WHERE id=1').get();
  assert.equal(audit.status, 'complete');
  assert.equal(audit.synthesis_status, 'failed');
  assert.equal(audit.synthesis_error, 'model offline');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM application_generation_jobs').get().n, 0);
  assert.ok(database.prepare("SELECT sql FROM sqlite_master WHERE name='application_generation_jobs'").get().sql.includes("needs_review"));
  database.close();
});

test('fresh and migrated schema expose the same v29 audit and queue columns', () => {
  const fresh = new Database(':memory:'); loadVecExtension(fresh); fresh.exec(schema);
  const migrated = new Database(':memory:'); loadVecExtension(migrated); migrated.exec(v28Schema()); migrated.exec(migration29);
  for (const table of ['job_listing_audits', 'application_generation_jobs']) {
    assert.deepEqual(migrated.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name), fresh.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
  }
  fresh.close(); migrated.close();
});
