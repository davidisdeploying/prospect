// server/similar.js — read-only KNN lookup over listings_vec (§5.2.1).
// Strictly SELECT-only: never touches listings/claims/listings_vec writes — those
// belong to server/enrich.js. Degrades to {results: []} rather than throwing
// whenever the vector layer isn't ready (unmigrated db, empty listings_vec, or a
// listing that hasn't been embedded yet) so an inert/PROSPECT_EMBEDDINGS=off
// deployment never 500s here.

// findSimilar(db, claimId, {k}) -> {results: [...]} | null
// null means "claim not found" (caller maps to 404); every other case, including
// a missing/empty vector layer, resolves to {results: []} rather than throwing.
export function findSimilar(db, claimId, { k = 5 } = {}) {
  const claim = db.prepare('SELECT id, listing_id FROM claims WHERE id = ?').get(claimId);
  if (!claim) return null;

  let vecRow;
  try {
    vecRow = db.prepare('SELECT embedding FROM listings_vec WHERE listing_id = ?').get(claim.listing_id);
  } catch (err) {
    return { results: [] }; // listings_vec doesn't exist yet (db below migration 006)
  }
  if (!vecRow) return { results: [] }; // claim's listing has no embedding row

  let neighbors;
  try {
    neighbors = db.prepare(`
      SELECT listing_id, distance FROM listings_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance
    `).all(vecRow.embedding, k + 1);
  } catch (err) {
    return { results: [] };
  }

  const distanceByListingId = new Map();
  for (const row of neighbors) {
    if (row.listing_id === claim.listing_id) continue; // exclude the target listing itself
    distanceByListingId.set(row.listing_id, row.distance);
  }
  const listingIds = [...distanceByListingId.keys()];
  if (listingIds.length === 0) return { results: [] };

  // Join back to the each neighbor listing's most recent claim (mirrors the
  // PRIOR_CLAIM_SUBQUERY pattern in repost.js) for display.
  const placeholders = listingIds.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT l.id AS listing_id, l.company, l.role, c.id AS claim_id, c.stage
    FROM listings l
    JOIN claims c ON c.id = (
      SELECT c2.id FROM claims c2 WHERE c2.listing_id = l.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
    )
    WHERE l.id IN (${placeholders})
  `).all(...listingIds);

  const results = rows
    .map((row) => ({
      claim_id: row.claim_id,
      company: row.company,
      role: row.role,
      stage: row.stage,
      distance: distanceByListingId.get(row.listing_id),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, k);

  return { results };
}
