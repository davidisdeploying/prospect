// server/migrate.js — minimal, explicit migration runner for Prospect.
// Applies migrations/NNN_*.sql whose NNN > current PRAGMA user_version, in order,
// each in its own transaction. Each migration file is responsible for setting
// `PRAGMA user_version = NNN;`. Run manually: `node server/migrate.js`.
// NOT wired into service boot (no surprise schema mutation on restart).
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from './vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PROSPECT_DB_PATH || path.join(__dirname, '..', 'data', 'prospect.db');
const MIG_DIR = path.join(__dirname, '..', 'migrations');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
// vec0 must be registered before any migration's CREATE VIRTUAL TABLE ... USING vec0 runs.
loadVecExtension(db);

const current = db.pragma('user_version', { simple: true });
const files = fs.readdirSync(MIG_DIR)
  .filter(f => /^\d{3}_.*\.sql$/.test(f))
  .sort();

let applied = 0;
for (const f of files) {
  const n = parseInt(f.slice(0, 3), 10);
  if (n <= current) { console.log(`skip ${f} (user_version already ${current})`); continue; }
  const sql = fs.readFileSync(path.join(MIG_DIR, f), 'utf8');
  console.log(`applying ${f} (${current} -> ${n}) ...`);
  db.exec('BEGIN;');
  try {
    db.exec(sql);
    db.exec('COMMIT;');
  } catch (e) {
    db.exec('ROLLBACK;');
    console.error(`FAILED ${f}: ${e.message}`);
    process.exit(1);
  }
  const now = db.pragma('user_version', { simple: true });
  if (now !== n) { console.error(`version mismatch after ${f}: expected ${n}, got ${now}`); process.exit(1); }
  console.log(`  ok, user_version now ${now}`);
  applied++;
}
console.log(`done. migrations applied: ${applied}. final user_version: ${db.pragma('user_version', { simple: true })}`);
db.close();
