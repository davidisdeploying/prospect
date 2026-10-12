import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schema = fs.readFileSync(path.join(root, 'schema.sql'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'migrations/030_salary_guidance.sql'), 'utf8');

function v29Schema() {
  return schema
    .replace('PRAGMA user_version = 32;', 'PRAGMA user_version = 29;')
    .replace(/\n-- Interview preparations \(migration 031\)[\s\S]*$/, '\n')
    .replace(/\n-- Salary guidance \(migration 030\)[\s\S]*?CREATE INDEX idx_salary_guidance_claim ON salary_guidance\(claim_id, id DESC\);\n/, '\n');
}

test('migration 030 preserves claims and creates no speculative backfill rows', () => {
  const db = new Database(':memory:');
  loadVecExtension(db);
  db.exec(v29Schema());
  db.prepare("INSERT INTO listings (id, source, company, role) VALUES (1, 'test', 'Example', 'Infrastructure Engineer')").run();
  db.prepare("INSERT INTO claims (id, listing_id, stage) VALUES (1, 1, 'Staked')").run();
  db.exec(migration);
  assert.equal(db.pragma('user_version', { simple: true }), 30);
  assert.equal(db.prepare('SELECT role FROM listings WHERE id=1').get().role, 'Infrastructure Engineer');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM salary_guidance').get().n, 0);
  db.close();
});

test('fresh and migrated schemas expose identical salary-guidance columns', () => {
  const fresh = new Database(':memory:'); loadVecExtension(fresh); fresh.exec(schema);
  const migrated = new Database(':memory:'); loadVecExtension(migrated); migrated.exec(v29Schema()); migrated.exec(migration);
  assert.deepEqual(
    migrated.prepare('PRAGMA table_info(salary_guidance)').all().map((row) => row.name),
    fresh.prepare('PRAGMA table_info(salary_guidance)').all().map((row) => row.name),
  );
  fresh.close(); migrated.close();
});
