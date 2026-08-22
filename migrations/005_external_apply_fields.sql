-- migrations/005_external_apply_fields.sql
-- Prospect schema v5 — external_job_id + apply_url on listings (ADDITIVE). v4 -> v5.
-- Applied by server/migrate.js ONLY when user_version < 5, in a single transaction. Never destructive.
-- Why: both are TYPED COMPARABLES derived from raw_payload (job-board ID, unwrapped apply target),
-- never written back into the immutable snapshot. Omit-not-guess: NULL when not extractable.

ALTER TABLE listings ADD COLUMN external_job_id TEXT;
ALTER TABLE listings ADD COLUMN apply_url TEXT;

PRAGMA user_version = 5;
