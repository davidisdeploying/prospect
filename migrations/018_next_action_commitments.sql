-- migrations/018_next_action_commitments.sql
-- Prospect schema v18 — next_action_commitments (ADDITIVE, append-only). v17 -> v18.
-- Applied by server/migrate.js ONLY when user_version < 18, in a single transaction. Never destructive.
--
-- Why (§6.3 honesty ledger): claims.next_action / claims.next_action_date are two mutable columns.
-- PATCHing them overwrites the prior promise with nothing recording what was promised, when, or how
-- many times the goalpost moved. An "honesty ledger" computed from those columns alone could only
-- ever describe the present, which is precisely the self-flattering view the section exists to
-- remove: a promise silently rewritten the day before it came due looks identical to one that was
-- never late.
--
-- Same shape and reasoning as migrations/011_resume_version_sends.sql one generation earlier:
-- claims.next_action / next_action_date stay in place as the "current" pointer, with the exact read
-- and patch shape every existing caller already uses, and this table is the append-only ledger of
-- every value that pair has ever held. Written by server/nextActionCommitments.js from the same
-- transaction as the PATCH that updates the columns. Insert-only, like stage_transitions /
-- claim_events / resume_version_sends: no UPDATE and no DELETE route.
--
-- No backfill, deliberately. The prior values were overwritten in place and are not recoverable, so
-- reconstructing them would mean inventing promises David may never have made. The ledger begins
-- empty and honest, and server/nextActionCommitments.js reports `recording_since` so a thin ledger
-- reads as "not yet observed" rather than "nothing was ever promised".
--
-- `event` vocabulary (validated in code, per this schema's no-CHECK-on-enums convention):
--   promised — the pair went from no open commitment to one
--   revised  — an open commitment's text and/or due date changed while still open
--   cleared  — an open commitment was removed (see the honesty note in nextActionCommitments.js:
--              Prospect observes that it was cleared, and never claims it was therefore completed)

CREATE TABLE next_action_commitments (
  id            INTEGER PRIMARY KEY,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  event         TEXT NOT NULL,
  action        TEXT,
  due_date      TEXT,
  prev_action   TEXT,
  prev_due_date TEXT,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_next_action_commitments_claim ON next_action_commitments(claim_id);
CREATE INDEX idx_next_action_commitments_recorded ON next_action_commitments(recorded_at);

PRAGMA user_version = 18;
