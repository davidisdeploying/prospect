-- migrations/008_claim_events.sql
-- Prospect schema v8 — claim_events (ADDITIVE, append-only). v7 -> v8.
-- Applied by server/migrate.js ONLY when user_version < 8, in a single transaction. Never destructive.
-- Why: §3.4 typed claim events — employer gates/touchpoints (assessment_requested,
-- assessment_completed, recruiter_contact, employer_email, status_check) that don't
-- necessarily move claims.stage. Feeds §4.2 response-latency (currently blind to
-- touchpoints that don't cause a stage transition) and §6.2's deadline queue
-- (due_at-bearing events). Insert-only, like stage_transitions -- no update/delete routes.

CREATE TABLE claim_events (
  id          INTEGER PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES claims(id),
  kind        TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at      TEXT,
  payload     TEXT
);
CREATE INDEX idx_claim_events_claim   ON claim_events(claim_id);
CREATE INDEX idx_claim_events_due_at  ON claim_events(due_at);

PRAGMA user_version = 8;
