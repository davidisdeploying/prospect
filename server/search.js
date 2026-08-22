// server/search.js — §5.2.2: fuses FTS5 text search with a query-time semantic
// KNN over listings_vec via Reciprocal Rank Fusion. Strictly read-only (no
// INSERT/UPDATE). The vec branch (embed + KNN + join) degrades to [] on ANY
// failure (Ollama down/timeout, unmigrated/empty listings_vec, bad embedding
// shape, KNN error) so it can never turn a working FTS5 search into a 500 —
// mirrors similar.js's degrade-to-{results:[]} contract for the vector layer.
import { embedQuery } from './embed.js';

// Sentinel markers (not HTML) bracket each snippet match so the frontend can highlight without
// dangerouslySetInnerHTML: listings.description/claim_notes.body come from scraped external
// postings and hand-typed notes, neither HTML-sanitized, so literal markup markers would let a
// crafted listing inject HTML into the app.
const SNIPPET_OPEN = '';
const SNIPPET_CLOSE = '';

const RRF_K = 60;
const VEC_K = 20;
const RESULT_LIMIT = 20;

function runFtsRows(db, q) {
  const listingRows = db.prepare(`
    SELECT c.id AS claim_id, l.company, l.role, c.stage,
           snippet(listings_fts, 2, ?, ?, '…', 10) AS snippet,
           bm25(listings_fts) AS rank
    FROM listings_fts
    JOIN listings l ON l.id = listings_fts.rowid
    JOIN claims c ON c.listing_id = l.id
    WHERE listings_fts MATCH ?
    ORDER BY rank LIMIT 20
  `).all(SNIPPET_OPEN, SNIPPET_CLOSE, q);

  const noteRows = db.prepare(`
    SELECT c.id AS claim_id, l.company, l.role, c.stage,
           snippet(claim_notes_fts, 0, ?, ?, '…', 10) AS snippet,
           bm25(claim_notes_fts) AS rank
    FROM claim_notes_fts
    JOIN claim_notes n ON n.id = claim_notes_fts.rowid
    JOIN claims c ON c.id = n.claim_id
    JOIN listings l ON l.id = c.listing_id
    WHERE claim_notes_fts MATCH ?
    ORDER BY rank LIMIT 20
  `).all(SNIPPET_OPEN, SNIPPET_CLOSE, q);

  return [...listingRows, ...noteRows];
}

function sanitizeFtsQuery(q) {
  return `"${q.replace(/"/g, '""')}"`;
}

// Dedup by claim_id keeping the lowest (best) bm25 rank, then sort ascending —
// identical to the pre-§5.2.2 /api/search handler's own logic.
function dedupeFtsRows(rows) {
  const byClaimId = new Map();
  for (const row of rows) {
    const existing = byClaimId.get(row.claim_id);
    if (!existing || row.rank < existing.rank) {
      byClaimId.set(row.claim_id, row);
    }
  }
  return [...byClaimId.values()].sort((a, b) => a.rank - b.rank).slice(0, RESULT_LIMIT);
}

// Raw q against MATCH; on any throw (malformed FTS5 syntax) retry once with q
// sanitized into a single quoted phrase; if that also throws, degrade to [].
function runFtsSearch(db, q) {
  try {
    return dedupeFtsRows(runFtsRows(db, q));
  } catch (err) {
    try {
      return dedupeFtsRows(runFtsRows(db, sanitizeFtsQuery(q)));
    } catch (err2) {
      return [];
    }
  }
}

// Join neighbor listing_ids back to each listing's most-recent claim — same
// correlated-subquery idiom similar.js/repost.js use.
function joinListingsToClaimRows(db, distanceByListingId) {
  const listingIds = [...distanceByListingId.keys()];
  if (listingIds.length === 0) return [];
  const placeholders = listingIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT l.id AS listing_id, l.company, l.role, c.id AS claim_id, c.stage
    FROM listings l
    JOIN claims c ON c.id = (
      SELECT c2.id FROM claims c2 WHERE c2.listing_id = l.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
    )
    WHERE l.id IN (${placeholders})
  `).all(...listingIds);

  return rows
    .map((row) => ({
      claim_id: row.claim_id,
      company: row.company,
      role: row.role,
      stage: row.stage,
      distance: distanceByListingId.get(row.listing_id),
    }))
    .sort((a, b) => a.distance - b.distance);
}

// The entire semantic branch — embed + KNN + join — degrades to [] on ANY
// failure. Never throws.
async function runVecSearch(db, q, embed) {
  try {
    const vector = await embed(q);
    const neighbors = db.prepare(`
      SELECT listing_id, distance FROM listings_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance
    `).all(vector, VEC_K);
    if (neighbors.length === 0) return [];

    const distanceByListingId = new Map();
    for (const row of neighbors) {
      distanceByListingId.set(row.listing_id, row.distance);
    }
    return joinListingsToClaimRows(db, distanceByListingId);
  } catch (err) {
    return [];
  }
}

// Reciprocal Rank Fusion: each list contributes 1/(RRF_K + position) per
// claim_id (1-based position); a claim present in both lists sums both
// contributions and ranks highest. bm25 rank and vector L2 distance are not
// directly comparable, so RRF (position-based, not score-based) is the merge.
function rrfMerge(ftsRows, vecRows) {
  const byClaimId = new Map();

  const addList = (rows, key) => {
    rows.forEach((row, idx) => {
      const contribution = 1 / (RRF_K + idx + 1);
      const existing = byClaimId.get(row.claim_id);
      if (existing) {
        existing.score += contribution;
        existing[key] = true;
      } else {
        byClaimId.set(row.claim_id, { row, score: contribution, inFts: false, inVec: false, [key]: true });
      }
    });
  };
  addList(ftsRows, 'inFts');
  addList(vecRows, 'inVec');

  return [...byClaimId.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, RESULT_LIMIT)
    .map(({ row, score, inFts, inVec }) => ({
      claim_id: row.claim_id,
      company: row.company,
      role: row.role,
      stage: row.stage,
      snippet: inFts ? row.snippet : null,
      match: inFts && inVec ? 'both' : inFts ? 'text' : 'semantic',
      score,
    }));
}

// runFusedSearch(db, q, {embed}) -> {results: [...]}. `embed` is injectable for
// tests; defaults to the real Ollama-backed embedQuery. Never throws — the vec
// branch degrades internally, so a search always resolves with at least the
// FTS5 results (or [] if even FTS5 fails, exactly as before §5.2.2).
export async function runFusedSearch(db, q, { embed = embedQuery } = {}) {
  if (!q) return { results: [] };

  const ftsRows = runFtsSearch(db, q);
  const vecRows = await runVecSearch(db, q, embed);

  return { results: rrfMerge(ftsRows, vecRows) };
}
