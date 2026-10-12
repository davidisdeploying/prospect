import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/031_interview_preparations.sql'), 'utf8');

function v30Schema() {
  return schema
    .replace('PRAGMA user_version = 32;', 'PRAGMA user_version = 30;')
    .replace(/\n-- Interview preparations \(migration 031\)[\s\S]*$/, '\n');
}

function v31Schema() {
  return schema
    .replace('PRAGMA user_version = 32;', 'PRAGMA user_version = 31;')
    .replace('  completed_at TEXT,\n  provider_error TEXT\n', '  completed_at TEXT\n')
    .replace(/\n-- Agent-backed interview research \(migration 032\)[\s\S]*$/, '\n');
}

test('migration 031 preserves claims and creates no speculative preparations', () => {
  const database = new Database(':memory:'); loadVecExtension(database); database.exec(v30Schema());
  database.prepare("INSERT INTO listings (id, source, company, role) VALUES (1, 'test', 'Example', 'Field Technician')").run();
  database.prepare("INSERT INTO claims (id, listing_id, stage) VALUES (39, 1, 'Staked')").run();
  database.exec(migration);
  assert.equal(database.pragma('user_version', { simple: true }), 31);
  assert.equal(database.prepare('SELECT role FROM listings WHERE id=1').get().role, 'Field Technician');
  assert.equal(database.prepare('SELECT COUNT(*) n FROM interview_preparations').get().n, 0);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM interview_preparation_artifacts').get().n, 0);
  assert.equal(database.prepare('SELECT COUNT(*) n FROM interview_preparation_events').get().n, 0);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  database.close();
});

test('fresh and migrated schemas expose identical interview-preparation columns', () => {
  const fresh = new Database(':memory:'); loadVecExtension(fresh); fresh.exec(v31Schema());
  const migrated = new Database(':memory:'); loadVecExtension(migrated); migrated.exec(v30Schema()); migrated.exec(migration);
  for (const table of ['interview_preparations', 'interview_preparation_artifacts', 'interview_preparation_events']) {
    assert.deepEqual(
      migrated.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      fresh.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name),
      table,
    );
  }
  fresh.close(); migrated.close();
});
