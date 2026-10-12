-- migrations/013_advisor.sql
-- Prospect schema v13 — posting-judgment advisor lifecycle + stored output (ADDITIVE, never
-- destructive). v12 -> v13. Applied by server/migrate.js ONLY when user_version < 13, in a
-- single transaction.
--
-- Why (§6.7.1, from the §6.7 AI-advisor scoping lock 2026-07-24): §6.7 owns JUDGMENT, not
-- deterministic derivation — a per-claim advisory over ONE listing's curated description +
-- parsed long tail (vague/self-contradictory comp language, seniority inconsistent with
-- described duties, staffing-agency-repost tells, questions worth asking before applying).
-- The scoping lock made two decisions this migration exists to satisfy:
--
--   1. "Advisor output is STORED, not ephemeral": its own derived table via an additive
--      migration, provenance-tagged (model + generated_at + which desc_hash generation it was
--      derived from) — never folded into the verbatim listings.parsed snapshot. listing_advisories
--      is that table: INSERT-only (no UPDATE/DELETE route), same append-only shape as
--      stage_transitions/claim_events/resume_version_sends — a listing can be re-advised across
--      snapshot generations and every generation stays on record, not just the latest.
--
--   2. listings needs its OWN lifecycle column for this worker (migration 010's lesson, applied
--      proactively a third time — see llm_parse_status's and skill_extract_status's own migration
--      comments): sharing enrichment_status/llm_parse_status/skill_extract_status would repeat
--      the exact collision migration 010 exists to fix. advisor_status is that column: NULL =
--      never attempted, else one of ('generating','generated','skipped','failed') — see
--      validate.js ENUMS.
--
-- No backfill: this capability does not exist yet anywhere in the codebase as of this migration
-- (same as migration 012's own no-backfill note) — every listing's advisor_status starts NULL and
-- listing_advisories starts empty until server/advise.js actually runs.

ALTER TABLE listings ADD COLUMN advisor_status TEXT;

CREATE TABLE listing_advisories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  desc_hash    TEXT NOT NULL,
  model        TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  advisory     TEXT NOT NULL
);
CREATE INDEX idx_listing_advisories_listing ON listing_advisories(listing_id);

PRAGMA user_version = 13;
