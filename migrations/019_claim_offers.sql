-- migrations/019_claim_offers.sql
-- Prospect schema v19 — claim_offers (ADDITIVE, append-only). v18 -> v19.
-- Applied by server/migrate.js ONLY when user_version < 19, in a single transaction. Never destructive.
--
-- Why (§6.1 Strike Sheet): reaching Strike is currently recorded as a stage and nothing else. The
-- number that arrived with it — the actual offer — has nowhere to live, so the one moment the whole
-- tracker exists to reach is also the only one it cannot describe. This table is that record.
--
-- Append-only, and for a sharper reason than the other ledgers in this schema: an offer is
-- NEGOTIATED. The first number and the final number are both real historical facts, and the
-- interesting quantity — what changed between them — only exists if the first one was never
-- overwritten. Each row is one offer generation, same insert-only shape as stage_transitions /
-- claim_events / resume_version_sends / next_action_commitments: no UPDATE and no DELETE route.
--
-- Components are stored separately and annualized, never as one blended figure. "$85k plus a 10%
-- bonus" and "$93.5k flat" compare equal on total and are not the same offer, and collapsing them
-- at write time would destroy the distinction permanently.
--
-- `source` is validated in code (ENUMS.offer_source), per this schema's no-CHECK-on-enums
-- convention: 'employer' is a figure an employer actually stated, 'estimate' is David's own
-- reconstruction. The Strike Sheet keeps them visually distinct and never lets an estimate be
-- mistaken for a quoted number.

CREATE TABLE claim_offers (
  id            INTEGER PRIMARY KEY,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  source        TEXT NOT NULL,
  base_annual   REAL,
  bonus_annual  REAL,
  equity_annual REAL,
  other_annual  REAL,
  currency      TEXT,
  note          TEXT,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claim_offers_claim ON claim_offers(claim_id, recorded_at);

PRAGMA user_version = 19;
