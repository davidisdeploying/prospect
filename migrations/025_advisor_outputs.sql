-- migrations/025_advisor_outputs.sql
-- Prospect schema v25 — stored output for the remaining §6.7 advisor slices (ADDITIVE, append-only).
-- v24 -> v25. Applied by server/migrate.js ONLY when user_version < 25. Never destructive.
--
-- Why one table for three slices, when §6.7.1 got its own (listing_advisories, migration 013): that
-- table is keyed on listing_id + desc_hash because a posting judgment is ABOUT a listing generation.
-- These three are not. §6.7.2 synthesizes across the whole Tailings population, §6.7.3 judges a
-- claim's liveness residue, and §6.7.4 drafts words for a due touchpoint. Three tables keyed three
-- different ways to hold three shapes of the same thing — "a model looked at X and said Y" — would
-- be ceremony, not structure.
--
-- Append-only, per the §6.7 scoping lock's "stored, not ephemeral" decision. A judgment is worth
-- keeping precisely so it can be read back later and found wrong.
--
-- input_hash is the idempotency key: a hash over the exact inputs the slice was given. Re-running
-- against unchanged inputs is a cheap no-op, and a changed input produces a NEW row rather than
-- overwriting the old judgment — the same generational posture as listing_advisories.
--
-- subject_type/subject_id are deliberately a loose pair rather than a foreign key, because the
-- subject is a claim for one slice and the whole corpus for another. server/deleteClaim.js cascades
-- the claim-scoped rows explicitly.
--
-- `slice` is validated in code (ADVISOR_SLICES in server/advisorSlices.js).

CREATE TABLE advisor_outputs (
  id           INTEGER PRIMARY KEY,
  slice        TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   INTEGER,
  input_hash   TEXT NOT NULL,
  model        TEXT NOT NULL,
  output       TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_advisor_outputs_slice ON advisor_outputs(slice, generated_at DESC);
CREATE INDEX idx_advisor_outputs_subject ON advisor_outputs(subject_type, subject_id);

PRAGMA user_version = 25;
