// server/calibration.js — §5.4 calibrated fit score. The prediction ledger, the outcome resolver,
// and the Brier scoring that only speaks once it has something to say.
//
// §5.4 is explicitly a slow burn: "start logging now, meaningful by month ~3". This module is the
// logging half built correctly, plus a scorer that REFUSES to report until the evidence exists.
// That refusal is the feature. A Brier score over three resolved applications is not a weak
// signal, it is a random number, and the damage of publishing one is that David would then make
// real decisions against it.
//
// THE THREE THINGS THIS SCORER WILL NOT DO:
//
// 1. Score a prediction made after the fact. claims.gut_prediction is mutable, so a forecast can be
//    quietly revised once a rejection lands. Predictions are logged append-only with the claim's
//    stage at the time, and any prediction recorded when the claim had already resolved is excluded
//    — otherwise the number measures hindsight and calls it foresight.
//
// 2. Count unresolved claims as failures. A claim still working its way through Working the Vein has no
//    outcome yet. Treating "not yet an offer" as "not an offer" would drag every score toward
//    pessimism and make an accurate forecaster look badly calibrated. Unresolved claims are
//    censored: counted, reported, and excluded from scoring.
//
// 3. Report a score below MIN_CALIBRATION_N. Below that the bins are returned empty and
//    `sufficient` is false, with the resolved count visible so "not yet" is distinguishable from
//    "measured, and it was bad".

export const MIN_CALIBRATION_N = 10;
export const PREDICTORS = Object.freeze(['gut', 'scout_fit', 'resume_cosine']);

const RESOLVED_POSITIVE = 'Strike';
const RESOLVED_NEGATIVE = 'Tailings';

function tableMissing(db, name) {
  return db.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?"
  ).get(name).n === 0;
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

// cosineSimilarity(a, b) over two Float32 vectors (or Buffers holding them). Returns null on any
// shape mismatch rather than a number computed from mismatched dimensions.
export function cosineSimilarity(a, b) {
  const va = a instanceof Float32Array ? a : new Float32Array(a.buffer ? a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength) : a);
  const vb = b instanceof Float32Array ? b : new Float32Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
  if (va.length === 0 || va.length !== vb.length) return null;
  let dot = 0; let normA = 0; let normB = 0;
  for (let i = 0; i < va.length; i += 1) {
    dot += va[i] * vb[i];
    normA += va[i] * va[i];
    normB += vb[i] * vb[i];
  }
  if (normA === 0 || normB === 0) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// recordPrediction(db, claimId, {...}) -> the inserted row, or null when there is nothing to record.
// Runs inside the caller's transaction if there is one; opens none of its own.
export function recordPrediction(db, claimId, { predictor, value, valueRaw = null, model = null, note = null }) {
  if (!PREDICTORS.includes(predictor)) throw new Error(`unknown predictor: ${predictor}`);
  const normalized = clamp01(value);
  if (normalized == null) return null;

  const claim = db.prepare('SELECT id, stage FROM claims WHERE id = ?').get(claimId);
  if (!claim) return null;

  // Skip an exact repeat of this predictor's most recent value: re-saving an unchanged form field
  // should not fill the ledger with duplicate "forecasts" that would each be scored.
  const last = db.prepare(`
    SELECT value FROM claim_predictions WHERE claim_id = ? AND predictor = ?
    ORDER BY recorded_at DESC, id DESC LIMIT 1
  `).get(claimId, predictor);
  if (last && Number(last.value) === normalized) return null;

  const info = db.prepare(`
    INSERT INTO claim_predictions (claim_id, predictor, value, value_raw, stage_at_prediction, model, note)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(claimId, predictor, normalized, valueRaw, claim.stage, model, note);
  return db.prepare('SELECT * FROM claim_predictions WHERE id = ?').get(info.lastInsertRowid);
}

// resolveOutcome(stage) -> 1 | 0 | null. null means UNRESOLVED, which is not the same as 0.
export function resolveOutcome(stage) {
  if (stage === RESOLVED_POSITIVE) return 1;
  if (stage === RESOLVED_NEGATIVE) return 0;
  return null;
}

function brier(pairs) {
  if (!pairs.length) return null;
  return pairs.reduce((sum, { p, o }) => sum + ((p - o) ** 2), 0) / pairs.length;
}

// Reliability bins: how often did things predicted at ~X% actually happen? Only built when the
// sample clears MIN_CALIBRATION_N, and empty bins are dropped rather than shown as 0%.
function reliabilityBins(pairs) {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const bins = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const inBin = pairs.filter(({ p }) => p >= edges[i] && p < edges[i + 1]);
    if (!inBin.length) continue;
    bins.push({
      range: `${Math.round(edges[i] * 100)}-${Math.round(Math.min(edges[i + 1], 1) * 100)}%`,
      n: inBin.length,
      mean_predicted: inBin.reduce((sum, { p }) => sum + p, 0) / inBin.length,
      observed_rate: inBin.reduce((sum, { o }) => sum + o, 0) / inBin.length,
    });
  }
  return bins;
}

// computeCalibration(db) -> {available, min_n, predictors, evidence_plan}
// Degrades to an explicitly unavailable shape on a pre-024 database rather than throwing.
export function computeCalibration(db) {
  const evidencePlan = {
    outcome: 'A claim resolves positive at Strike and negative at Tailings. Anything else is still '
      + 'running and is censored, not counted as a failure.',
    prediction_validity: 'Only predictions recorded while the claim was still unresolved are scored. '
      + 'A forecast entered after the outcome was known measures hindsight.',
    minimum: `No score is reported below ${MIN_CALIBRATION_N} resolved outcomes per predictor.`,
    scoring: 'Brier score (mean squared error of the forecast); lower is better, 0.25 is what a '
      + 'flat 50% guess scores.',
  };

  if (tableMissing(db, 'claim_predictions')) {
    return { available: false, min_n: MIN_CALIBRATION_N, predictors: [], evidence_plan: evidencePlan };
  }

  const rows = db.prepare(`
    SELECT p.*, c.stage AS current_stage
    FROM claim_predictions p JOIN claims c ON c.id = p.claim_id
    ORDER BY p.claim_id ASC, p.recorded_at ASC, p.id ASC
  `).all();

  const predictors = PREDICTORS.map((predictor) => {
    const mine = rows.filter((row) => row.predictor === predictor);

    // One prediction per claim: the LAST one made while the claim was still unresolved. Scoring
    // every revision would weight indecisive claims more heavily than confident ones.
    const byClaim = new Map();
    let discardedPostHoc = 0;
    for (const row of mine) {
      if (resolveOutcome(row.stage_at_prediction) != null) { discardedPostHoc += 1; continue; }
      byClaim.set(row.claim_id, row);
    }

    const pairs = [];
    let censored = 0;
    for (const row of byClaim.values()) {
      const outcome = resolveOutcome(row.current_stage);
      if (outcome == null) { censored += 1; continue; }
      pairs.push({ p: Number(row.value), o: outcome });
    }

    const sufficient = pairs.length >= MIN_CALIBRATION_N;
    return {
      predictor,
      predictions_logged: mine.length,
      claims_with_prediction: byClaim.size,
      resolved: pairs.length,
      censored,
      discarded_post_hoc: discardedPostHoc,
      sufficient,
      // Everything below is null until the evidence exists. Deliberately not "0" -- see the header.
      brier: sufficient ? brier(pairs) : null,
      // The score a flat 50% guess would get, for comparison. Only shown when a real score is.
      baseline_brier: sufficient ? 0.25 : null,
      bins: sufficient ? reliabilityBins(pairs) : [],
    };
  });

  return { available: true, min_n: MIN_CALIBRATION_N, predictors, evidence_plan: evidencePlan };
}

// resumeCosinePrediction(db, claimId, {embedDocument}) -> the recorded row, or null.
// Best-effort by design: needs a résumé version carrying text, a listing already embedded, and a
// reachable embedding service. Any of those missing means no prediction, never a fabricated one.
export async function resumeCosinePrediction(db, claimId, { embedDocument, model = null } = {}) {
  if (typeof embedDocument !== 'function') return null;

  const claim = db.prepare(`
    SELECT c.id, c.listing_id, r.body AS resume_body
    FROM claims c LEFT JOIN resume_versions r ON r.id = c.resume_version_id
    WHERE c.id = ?
  `).get(claimId);
  if (!claim || !claim.resume_body || !String(claim.resume_body).trim() || claim.listing_id == null) return null;

  let listingVector;
  try {
    const row = db.prepare('SELECT embedding FROM listings_vec WHERE listing_id = ?').get(claim.listing_id);
    if (!row) return null;
    listingVector = row.embedding;
  } catch {
    return null; // listings_vec absent (pre-006 db)
  }

  let resumeVector;
  try {
    resumeVector = await embedDocument(String(claim.resume_body));
  } catch {
    return null; // embedding service unreachable or slow -- never block, never guess
  }

  const cosine = cosineSimilarity(resumeVector, listingVector);
  if (cosine == null) return null;

  // Cosine over nomic-embed-text's document space sits well above 0 for unrelated text, so it is
  // rescaled from [0,1] rather than [-1,1]. This is a MAPPING, not a probability -- value_raw keeps
  // the original so a better calibration map can replace this one without losing the measurement.
  return recordPrediction(db, claimId, {
    predictor: 'resume_cosine',
    value: clamp01(cosine),
    valueRaw: cosine,
    model,
    note: 'cosine(resume, JD) rescaled to 0-1; see value_raw for the measurement',
  });
}
