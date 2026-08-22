-- migrations/003_transition_outcome_reason.sql
-- Prospect schema v3 — per-transition outcome reason (ADDITIVE). Takes PRAGMA user_version 2 -> 3.
-- Applied by server/migrate.js ONLY when user_version < 3, in a single transaction. Never destructive.
-- Why: claims.outcome_reason only holds the CURRENT value; a claim can be re-opened and dropped again
-- with a different reason, and the prior reason was lost. This captures it per-transition, append-only.

ALTER TABLE stage_transitions ADD COLUMN outcome_reason TEXT;

PRAGMA user_version = 3;
