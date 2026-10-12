// scripts/repair-enrichment-status.js — one-shot data repair for the llm-parse/enrich
// enrichment_status collision fixed by migrations/010.
//
// Before 010, server/llmParse.js borrowed listings.enrichment_status — enrich.js's EMBEDDING
// lifecycle column. Its boot backfill re-queues every described listing on each restart, so
// already-parsed rows were stamped 'skipped' (and one 'failed') straight over 'embedded'.
// The column then understated reality: 9 of 15 live rows read skipped/failed while every one
// of them had a real listings_vec row and an embedding_model.
//
// This script restores the truth. It does NOT guess: a row is re-marked 'embedded' only when
// BOTH independent pieces of evidence written by enrich.js's writeEmbedding() transaction are
// present — a listings_vec row AND a non-NULL embedding_model. Rows missing either are left
// exactly as they are, whatever they say. Nothing else is written; no snapshot, raw_payload,
// description, parsed or *_family value is touched.
//
// Idempotent and safe to re-run: a second run reports 0 candidates.
// Dry-run by default. Pass --apply to write.
//
//   node scripts/repair-enrichment-status.js            # report only
//   node scripts/repair-enrichment-status.js --apply     # write
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { loadVecExtension } from '../server/vecExtension.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.PROSPECT_DB_PATH || path.join(__dirname, '..', 'data', 'prospect.db');
const APPLY = process.argv.includes('--apply');

const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
loadVecExtension(db);

const rows = db.prepare(`
  SELECT id, enrichment_status, embedding_model, enriched_at
  FROM listings
  WHERE enrichment_status IS NOT 'embedded'
  ORDER BY id
`).all();

const repairable = [];
const leftAlone = [];
for (const r of rows) {
  const vecRows = db.prepare('SELECT count(*) c FROM listings_vec WHERE listing_id = ?').get(BigInt(r.id)).c;
  const hasEvidence = vecRows > 0 && r.embedding_model != null;
  (hasEvidence ? repairable : leftAlone).push({ ...r, vecRows });
}

console.log(`db: ${DB_PATH}`);
console.log(`rows not marked 'embedded': ${rows.length}`);
console.log(`  repairable (vec row AND embedding_model both present): ${repairable.length}`);
for (const r of repairable) {
  console.log(`    id=${r.id}  '${r.enrichment_status}' -> 'embedded'   (vec_rows=${r.vecRows}, model=${r.embedding_model}, enriched_at=${r.enriched_at})`);
}
console.log(`  left untouched (evidence incomplete — genuinely not embedded): ${leftAlone.length}`);
for (const r of leftAlone) {
  console.log(`    id=${r.id}  '${r.enrichment_status}' kept  (vec_rows=${r.vecRows}, model=${r.embedding_model ?? 'NULL'})`);
}

if (!APPLY) {
  console.log('\nDRY RUN — nothing written. Re-run with --apply to commit these changes.');
  db.close();
  process.exit(0);
}

const write = db.transaction((list) => {
  const stmt = db.prepare("UPDATE listings SET enrichment_status = 'embedded' WHERE id = ?");
  for (const r of list) stmt.run(r.id);
});
write(repairable);

const after = db.prepare(`
  SELECT enrichment_status, count(*) c FROM listings GROUP BY 1 ORDER BY 1
`).all();
console.log(`\nAPPLIED. rows updated: ${repairable.length}`);
console.log('enrichment_status spread now:');
for (const a of after) console.log(`  ${a.enrichment_status}: ${a.c}`);
db.close();
