// server/enrich.js — in-process embedding worker (Phase 5 §5.1), default-OFF.
// Gated by PROSPECT_EMBEDDINGS ('1' = on); unset/'0' = enqueue() is a no-op and
// no interval/Ollama traffic ever starts — the product is whole without this.
// Writes ONLY the derived layer (listings_vec + listings.enrichment_status/
// enriched_at/embedding_model) — NEVER listings.raw_payload/snapshot_hash.
import { db } from './db.js';

const ENABLED = process.env.PROSPECT_EMBEDDINGS === '1';
import { OLLAMA_URL, EMBED_MODEL } from './ollamaConfig.js';
const DRAIN_INTERVAL_MS = 3000;

const pending = new Set();
let draining = false;

function buildEmbedInput(listing) {
  const parts = [listing.role, listing.company, listing.description].filter(Boolean);
  return `search_document: ${parts.join('\n')}`;
}

function vecBuffer(embedding) {
  return Buffer.from(Float32Array.from(embedding).buffer);
}

// vec0 tables don't support ON CONFLICT/INSERT OR REPLACE (UNIQUE constraint
// error on the primary key even with the REPLACE clause) — delete-then-insert
// is the idempotent way to (re)write a row.
function writeEmbedding(listingId, embedding) {
  const write = db.transaction(() => {
    const id = BigInt(listingId);
    db.prepare('DELETE FROM listings_vec WHERE listing_id = ?').run(id);
    db.prepare('INSERT INTO listings_vec (listing_id, embedding) VALUES (?, ?)').run(id, vecBuffer(embedding));
    db.prepare(`
      UPDATE listings SET enrichment_status = 'embedded', enriched_at = datetime('now'), embedding_model = ?
      WHERE id = ?
    `).run(EMBED_MODEL, listingId);
  });
  write();
}

// Fetches an embedding for one listing and writes it to the derived layer.
// Never throws — failures degrade the listing to enrichment_status='failed'
// and log, so a bad row or an Ollama outage can't take the worker down.
export async function embedListing(listingId) {
  const listing = db.prepare('SELECT role, company, description FROM listings WHERE id = ?').get(listingId);
  if (!listing) return;
  try {
    const input = buildEmbedInput(listing);
    const res = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input }),
    });
    if (!res.ok) throw new Error(`ollama /api/embed returned ${res.status}`);
    const data = await res.json();
    const embedding = data.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length !== 768) {
      throw new Error(`unexpected embedding shape: ${Array.isArray(embedding) ? embedding.length : typeof embedding}`);
    }
    writeEmbedding(listingId, embedding);
  } catch (err) {
    console.error(`enrich: listing ${listingId} failed: ${err.message}`);
    db.prepare(`UPDATE listings SET enrichment_status = 'failed' WHERE id = ?`).run(listingId);
  }
}

async function drainOne() {
  if (draining) return;
  const listingId = pending.values().next().value;
  if (listingId === undefined) return;
  pending.delete(listingId);
  draining = true;
  try {
    await embedListing(listingId);
  } finally {
    draining = false;
  }
}

export const enqueue = ENABLED
  ? (listingId) => { if (listingId != null) pending.add(listingId); }
  : () => {};

if (ENABLED) {
  setInterval(() => { drainOne(); }, DRAIN_INTERVAL_MS);
  const toBackfill = db.prepare(`SELECT id FROM listings WHERE enrichment_status != 'embedded'`).all();
  for (const row of toBackfill) enqueue(row.id);
}
