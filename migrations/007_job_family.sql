-- migrations/007_job_family.sql
-- Prospect schema v7 — job_family on listings (ADDITIVE). v6 -> v7.
-- Applied by server/migrate.js ONLY when user_version < 7, in a single transaction. Never destructive.
-- Why: §5.2.4 deterministic title-clustering (server/jobFamily.js) needs its own column — it is a
-- DIFFERENT axis from the locked §1.2 role_family enum (ENUMS.role_family, LinkedIn-adapter-owned)
-- and must not collide with it. NULL = not yet classified (offline backfill via
-- scripts/backfill-job-families.js populates it; no default).

ALTER TABLE listings ADD COLUMN job_family TEXT;

PRAGMA user_version = 7;
