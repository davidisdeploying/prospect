import { titleJaccard, REPOST_TITLE_JACCARD_THRESHOLD } from './validate.js';

// A listing's most recent claim (a listing can, in principle, be re-claimed).
const PRIOR_CLAIM_SUBQUERY = `(
  SELECT c2.id FROM claims c2 WHERE c2.listing_id = l.id ORDER BY c2.created_at DESC, c2.id DESC LIMIT 1
)`;

// §5.2.3 semantic tier threshold (L2 distance over unit-normalized nomic-embed-text
// vectors). Calibrated on a synthetic set (see build response for FLEET-WORKER1-BUILD-
// 20260719-523-repost-detect): known-repost variants (title swap, per-render token
// churn, light rewording) clustered at 0.059-0.176 L2; genuinely-different listings
// clustered at 0.776-0.890, consistent with a real production data point (two
// different same-family IT-support listings at 0.748 L2). Set well above the repost
// cluster and well below the different-listing floor, erring tight (advisory-only —
// a miss is safe, a false positive is noise).
export const REPOST_SEMANTIC_L2_MAX = 0.3;

// detectRepost(db, {descHash, canonicalName, role}) -> candidate | null
// Deterministic, no ML: EXACT tier on desc_hash equality, else LIKELY tier on
// same canonical company + role-title token overlap >= threshold. Read-only —
// callers must run this BEFORE inserting the incoming listing.
export function detectRepost(db, { descHash, canonicalName, role }) {
  if (descHash) {
    const exact = db.prepare(`
      SELECT l.id AS prior_listing_id, l.company, l.role, l.description AS prior_description,
             c.id AS prior_claim_id, c.stage, c.outcome_reason
      FROM listings l
      LEFT JOIN claims c ON c.id = ${PRIOR_CLAIM_SUBQUERY}
      WHERE l.desc_hash = @descHash
      ORDER BY l.captured_at DESC, l.id DESC
      LIMIT 1
    `).get({ descHash });
    if (exact) return { tier: 'exact', ...exact };
  }

  if (canonicalName && role && String(role).trim()) {
    const candidates = db.prepare(`
      SELECT l.id AS prior_listing_id, l.company, l.role, l.description AS prior_description,
             c.id AS prior_claim_id, c.stage, c.outcome_reason
      FROM listings l
      JOIN companies co ON co.id = l.company_id
      LEFT JOIN claims c ON c.id = ${PRIOR_CLAIM_SUBQUERY}
      WHERE co.canonical_name = @canonicalName
      ORDER BY l.captured_at DESC, l.id DESC
    `).all({ canonicalName });

    let best = null;
    for (const candidate of candidates) {
      const similarity = titleJaccard(role, candidate.role);
      if (similarity >= REPOST_TITLE_JACCARD_THRESHOLD && (best == null || similarity > best.title_similarity)) {
        best = { ...candidate, title_similarity: similarity };
      }
    }
    if (best) return { tier: 'likely', ...best };
  }

  return null;
}

// detectSemanticRepost(db, embedding) -> candidate | null
// Semantic third tier (§5.2.3): KNN over listings_vec (read-only, over OTHER
// rows' already-derived embeddings — the incoming listing is never in
// listings_vec yet at this point) for the nearest neighbor within
// REPOST_SEMANTIC_L2_MAX. Callers must only invoke this when EXACT and LIKELY
// both missed (this tier is advisory-only and must never mask/override them).
// Never throws by design intent, but callers still wrap it in a best-effort
// try/catch alongside the embed call, since a missing/unmigrated listings_vec
// table throws from better-sqlite3, not from here.
export function detectSemanticRepost(db, embedding) {
  const neighbor = db.prepare(`
    SELECT listing_id, distance FROM listings_vec WHERE embedding MATCH ? AND k = ? ORDER BY distance
  `).get(embedding, 1);
  if (!neighbor || neighbor.distance > REPOST_SEMANTIC_L2_MAX) return null;

  const row = db.prepare(`
    SELECT l.id AS prior_listing_id, l.company, l.role, l.description AS prior_description,
           c.id AS prior_claim_id, c.stage, c.outcome_reason
    FROM listings l
    LEFT JOIN claims c ON c.id = ${PRIOR_CLAIM_SUBQUERY}
    WHERE l.id = ?
  `).get(neighbor.listing_id);
  if (!row) return null;

  return { tier: 'semantic', ...row, distance: neighbor.distance };
}

// lineDiff(prior, incoming) -> [{type:'context'|'add'|'remove', text}, ...]
// LCS-based line diff, no dependency. Read-only view over two strings.
export function lineDiff(priorText, incomingText) {
  const a = String(priorText ?? '').split('\n');
  const b = String(incomingText ?? '').split('\n');
  const n = a.length, m = b.length;

  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'remove', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: 'remove', text: a[i] }); i++; }
  while (j < m) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

export class RepostLinkError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// linkRepost(db, claimId, repostOf) -> {listing_id, repost_of, snapshot_generation}
// The ONLY listings UPDATE anywhere: David-initiated, writes ONLY the
// incoming (claimId's) listing row. The prior snapshot is never touched.
export function linkRepost(db, claimId, repostOf) {
  const claim = db.prepare('SELECT id, listing_id FROM claims WHERE id = ?').get(claimId);
  if (!claim) throw new RepostLinkError(404, 'claim not found');

  if (repostOf == null) {
    throw new RepostLinkError(400, 'repost_of is required and must be an existing listing id');
  }
  if (repostOf === claim.listing_id) {
    throw new RepostLinkError(400, "repost_of cannot be the claim's own listing");
  }
  const prior = db.prepare('SELECT id, snapshot_generation FROM listings WHERE id = ?').get(repostOf);
  if (!prior) {
    throw new RepostLinkError(400, 'repost_of must reference an existing listing');
  }

  const snapshotGeneration = (prior.snapshot_generation || 1) + 1;
  db.prepare('UPDATE listings SET repost_of = ?, snapshot_generation = ? WHERE id = ?')
    .run(repostOf, snapshotGeneration, claim.listing_id);

  return { listing_id: claim.listing_id, repost_of: repostOf, snapshot_generation: snapshotGeneration };
}
