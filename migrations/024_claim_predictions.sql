-- migrations/024_claim_predictions.sql
-- Prospect schema v24 — prediction ledger for calibration (ADDITIVE, append-only). v23 -> v24.
-- Applied by server/migrate.js ONLY when user_version < 24, in a single transaction. Never destructive.
--
-- Why (§5.4): calibration compares what was predicted BEFORE the outcome was known against what
-- actually happened. claims.gut_prediction is a single mutable column, so today a prediction can be
-- revised after a rejection lands and nothing records that it was ever different. Scoring against
-- that column would measure hindsight and call it foresight — the one failure mode that makes a
-- calibration number worse than no number at all.
--
-- So predictions are logged append-only, timestamped, with the claim's stage AT THE TIME recorded
-- alongside. A prediction made while the claim sat at Staked is a real forecast; one made after it
-- reached Strike is not, and stage_at_prediction is what lets the scorer tell them apart and
-- exclude the second kind.
--
-- `predictor` is validated in code (ENUMS.predictor):
--   gut           — David's own 0-1 odds (claims.gut_prediction). The wildcard §5.4 exists to score.
--   scout_fit     — Scout's fit_score at the moment a discovery was staked, rescaled to 0-1.
--   resume_cosine — cosine(resume, JD) from the §5.1 embedding layer, when the claim's résumé
--                   version carries text and embeddings are enabled. Best-effort and frequently
--                   absent, which is why it is one predictor among several rather than the schema.
--
-- value is always 0-1 so predictors are directly comparable and Brier-scorable. value_raw keeps the
-- predictor's own units (Scout's 0-100, a raw cosine) so a rescaling choice made today can be
-- revisited without losing the original measurement.
--
-- resume_versions.body is added here because §5.4's headline comparison is cosine(resume, JD) and
-- Prospect held résumé LABELS but never résumé text — the correlation was unbuildable, not merely
-- unbuilt. Nullable: a version with no text simply produces no resume_cosine prediction.

CREATE TABLE claim_predictions (
  id                  INTEGER PRIMARY KEY,
  claim_id            INTEGER NOT NULL REFERENCES claims(id),
  predictor           TEXT NOT NULL,
  value               REAL NOT NULL,
  value_raw           REAL,
  stage_at_prediction TEXT,
  model               TEXT,
  note                TEXT,
  recorded_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claim_predictions_claim ON claim_predictions(claim_id, recorded_at);
CREATE INDEX idx_claim_predictions_predictor ON claim_predictions(predictor);

ALTER TABLE resume_versions ADD COLUMN body TEXT;

PRAGMA user_version = 24;
