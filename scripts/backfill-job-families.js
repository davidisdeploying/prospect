// scripts/backfill-job-families.js — §5.2.4 offline batch runner.
// Reads every listing's role title, classifies it via classifyJobFamily
// (deterministic title-normalization, no embeddings/LLM), and writes the
// result to listings.job_family. Idempotent: safe to re-run, always
// overwrites to the same result for unchanged titles.
//
// Run manually: PROSPECT_DB_PATH=/path/to/db.sqlite node scripts/backfill-job-families.js
//
// listings.job_family is a NEW additive column (migrations/007), distinct
// from the locked §1.2 role_family enum (server/validate.js ENUMS.role_family)
// populated by the LinkedIn extension adapter. This script never touches
// role_family.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { classifyJobFamily } from '../server/jobFamily.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PROSPECT_DB_PATH || path.join(__dirname, '..', 'data', 'prospect.db');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');

const rows = db.prepare('SELECT id, role FROM listings').all();
const update = db.prepare('UPDATE listings SET job_family = @job_family WHERE id = @id');

const applied = db.transaction((listings) => {
  let count = 0;
  for (const { id, role } of listings) {
    update.run({ id, job_family: classifyJobFamily(role) });
    count++;
  }
  return count;
});

const n = applied(rows);
console.log(`job_family backfilled for ${n} listing(s).`);
db.close();
