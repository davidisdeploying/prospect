import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from './vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const STAGES = ['Showings', 'Staked', 'Working the Vein', 'Strike', 'Tailings'];

const dbPath = process.env.PROSPECT_DB_PATH || path.join(__dirname, '..', 'data', 'prospect.db');

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
loadVecExtension(db);
