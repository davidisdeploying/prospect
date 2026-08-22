-- migrations/022_vendor_status.sql
-- Prospect schema v22 — external vendor-status observations (ADDITIVE, append-only). v21 -> v22.
-- Applied by server/migrate.js ONLY when user_version < 22, in a single transaction. Never destructive.
--
-- Why (§3.5b): §3.5a gave claims a vendor_tracker_url — the employer-side portal where an
-- application's status is displayed. What that portal SAYS was still nowhere. The 2026-07-18
-- intel pass recorded the cost of that gap precisely: an older Amazon application showed
-- "Assessment expired" in the employer's own tracker while Prospect's stage log showed nothing at
-- all. The application had died silently, employer-side, and the tracker that existed to never lose
-- an application had no idea.
--
-- THE INVARIANT THIS TABLE PROTECTS. Employer-claimed status is NOT David's stage, and the two must
-- never be merged. An employer portal saying "no longer under consideration" is a fact about what
-- the employer is displaying; David's stage is his own record of where the application stands. They
-- disagree often and interestingly — a portal stuck on "submitted" for six weeks is a signal, and
-- averaging it into the stage would destroy exactly that signal. So this is a separate append-only
-- observation log, and nothing here ever writes claims.stage.
--
-- status_text is stored VERBATIM as the employer worded it. normalized_status is a derived,
-- provenance-tagged interpretation (normalized_by records which adapter produced it) held in its own
-- column, following the same separation the listings table uses for parsed vs raw_payload. An
-- unrecognized phrase leaves normalized_status NULL rather than being forced into the nearest
-- bucket: a wrong normalization here would mean silently declaring an application dead.
--
-- Observations are append-only: a status seen today does not replace what the portal said last week,
-- because the sequence is the whole point.

CREATE TABLE vendor_status_observations (
  id                INTEGER PRIMARY KEY,
  claim_id          INTEGER NOT NULL REFERENCES claims(id),
  vendor            TEXT,
  status_text       TEXT NOT NULL,
  normalized_status TEXT,
  normalized_by     TEXT,
  source_url        TEXT,
  note              TEXT,
  observed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vendor_status_claim ON vendor_status_observations(claim_id, observed_at);

PRAGMA user_version = 22;
