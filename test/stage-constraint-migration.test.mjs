import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const schemaSql = readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');
const migrationSql = readFileSync(path.join(ROOT, 'migrations/026_stage_constraint.sql'), 'utf8');
const retiredStage = 'A' + 'ssay';
function schema25Sql() { return schemaSql.split('\n-- Job listing audits (migration 027)')[0].replace('PRAGMA user_version = 27;', 'PRAGMA user_version = 25;').replace("CHECK (stage IN ('Showings','Staked','Working the Vein','Strike','Tailings')),", "CHECK (stage IN ('Showings','Staked','" + retiredStage + "','Working the Vein','Strike','Tailings'))," ); }
function applyLikeRunner(db) { db.pragma('foreign_keys = ON'); db.exec('BEGIN;'); try { db.exec(migrationSql); db.exec('COMMIT;'); } catch (error) { db.exec('ROLLBACK;'); throw error; } }
function tableCounts(db) { const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(); return Object.fromEntries(names.map(({ name }) => [name, db.prepare('SELECT COUNT(*) AS count FROM "' + name.replaceAll('"', '""') + '"').get().count])); }
function scratchPath(label) { const dir = mkdtempSync(path.join(os.tmpdir(), 'prospect-stage-migration-' + label + '-')); return { dir, db: path.join(dir, 'scratch.db') }; }
function cleanup({ dir }) { rmSync(dir, { recursive: true, force: true }); }
test('migration 026 preserves populated claim rows and children under runner transaction semantics', () => {
  const db = new Database(':memory:'); loadVecExtension(db); db.pragma('foreign_keys = ON'); db.exec(schema25Sql());
  const listingId = db.prepare("INSERT INTO listings (source, company, role, snapshot_hash) VALUES ('Manual', 'MigrateCo', 'Dev', 'abc123')").run().lastInsertRowid;
  const input = { listing_id: listingId, stage: 'Staked', created_at: '2026-08-01 10:00:00', updated_at: '2026-08-02 11:00:00', next_action: 'Follow up', next_action_date: '2026-08-03', applied_at: '2026-08-01', stage_entered_at: '2026-08-01', outcome_reason: null, resume_version_id: null, referral: 1, cover_letter: 0, application_minutes: 42, gut_prediction: 0.7, days_posted_at_apply: 3, vendor_tracker_url: 'https://example.test/status', hunt_id: null };
  const columns = Object.keys(input);
  const claimId = db.prepare('INSERT INTO claims (' + columns.join(', ') + ') VALUES (' + columns.map((key) => '@' + key).join(', ') + ')').run(input).lastInsertRowid;
  const childId = db.prepare("INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause) VALUES (?, 'Showings', 'Staked', '2026-08-01 10:00:00', 'manual')").run(claimId).lastInsertRowid;
  const before = db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId);
  applyLikeRunner(db);
  assert.equal(db.pragma('user_version', { simple: true }), 26); assert.deepEqual(db.prepare('SELECT * FROM claims WHERE id = ?').get(claimId), before); assert.equal(db.prepare('SELECT claim_id FROM stage_transitions WHERE id = ?').get(childId).claim_id, claimId); assert.deepEqual(db.pragma('quick_check'), [{ quick_check: 'ok' }]); assert.deepEqual(db.pragma('foreign_key_check'), []); assert.throws(() => db.prepare("INSERT INTO claims (listing_id, stage) VALUES (?, 'Invalid')").run(listingId), /CHECK constraint failed/); db.close();
});
test('migration 026 fails closed for a preexisting out-of-model stage', () => {
 const db = new Database(':memory:'); loadVecExtension(db); db.pragma('foreign_keys = ON'); db.exec(schema25Sql()); const listingId = db.prepare("INSERT INTO listings (source, company, role) VALUES ('Manual', 'InvalidCo', 'Dev')").run().lastInsertRowid; db.prepare('INSERT INTO claims (listing_id, stage) VALUES (?, ?)').run(listingId, retiredStage); assert.throws(() => applyLikeRunner(db), /CHECK constraint failed/); assert.equal(db.pragma('user_version', { simple: true }), 25); db.close();
});
test('server migration runner upgrades a populated schema-25 database through schema 27', () => {
  const scratch = scratchPath('runner');
  const source = new Database(scratch.db);
  loadVecExtension(source);
  source.pragma('foreign_keys = ON');
  source.exec(schema25Sql());
  const listingId = source.prepare(`
    INSERT INTO listings (source, company, role, snapshot_hash)
    VALUES ('Manual', 'RunnerCo', 'Engineer', 'runner-hash')
  `).run().lastInsertRowid;
  const claimId = source.prepare(`
    INSERT INTO claims (listing_id, stage, applied_at, stage_entered_at)
    VALUES (?, 'Staked', '2026-08-01', '2026-08-01')
  `).run(listingId).lastInsertRowid;
  source.prepare(`
    INSERT INTO stage_transitions (claim_id, from_stage, to_stage, transitioned_at, transition_cause)
    VALUES (?, 'Showings', 'Staked', '2026-08-01 10:00:00', 'manual')
  `).run(claimId);
  const countsBefore = tableCounts(source);
  const representative = source.prepare(`
    SELECT c.*, l.snapshot_hash
    FROM claims c JOIN listings l ON l.id = c.listing_id
    WHERE c.id = ?
  `).get(claimId);
  source.close();

  try {
    execFileSync(process.execPath, ['server/migrate.js'], {
      cwd: ROOT,
      env: { ...process.env, PROSPECT_DB_PATH: scratch.db },
      stdio: 'pipe',
    });
    const migrated = new Database(scratch.db);
    loadVecExtension(migrated);
    try {
      assert.equal(migrated.pragma('user_version', { simple: true }), 27);
      const countsAfter = tableCounts(migrated);
      for (const [table, count] of Object.entries(countsBefore)) assert.equal(countsAfter[table], count);
      assert.equal(countsAfter.job_listing_audits, 0);
      assert.deepEqual(migrated.prepare(`
        SELECT c.*, l.snapshot_hash
        FROM claims c JOIN listings l ON l.id = c.listing_id
        WHERE c.id = ?
      `).get(claimId), representative);
      assert.deepEqual(migrated.pragma('quick_check'), [{ quick_check: 'ok' }]);
      assert.deepEqual(migrated.pragma('foreign_key_check'), []);
      assert.throws(
        () => migrated.prepare("INSERT INTO claims (listing_id, stage) VALUES (?, 'Invalid')").run(listingId),
        /CHECK constraint failed/,
      );
    } finally {
      migrated.close();
    }
  } finally {
    cleanup(scratch);
  }
});
