-- Prospect schema v31 - immutable, user-initiated interview preparation.
--
-- Preparations are claim-scoped snapshots. They preserve the exact listing generation,
-- Career evidence digest, selected resume provenance, and interview context used to
-- render a guide. Repeated Prepare clicks are idempotent; explicit regeneration creates
-- another immutable generation. No migration backfill is performed.

CREATE TABLE interview_preparations (
  id                           INTEGER PRIMARY KEY,
  request_key                  TEXT NOT NULL UNIQUE,
  source_input_hash            TEXT NOT NULL,
  claim_id                     INTEGER NOT NULL REFERENCES claims(id),
  interview_id                 INTEGER REFERENCES interviews(id),
  listing_id                   INTEGER NOT NULL REFERENCES listings(id),
  listing_snapshot_generation INTEGER NOT NULL,
  listing_snapshot_hash       TEXT NOT NULL,
  resume_version_id            INTEGER NOT NULL REFERENCES resume_versions(id),
  resume_confirmed_sent        INTEGER NOT NULL DEFAULT 0 CHECK (resume_confirmed_sent IN (0,1)),
  career_claims_sha256         TEXT NOT NULL,
  career_claims_schema_version INTEGER NOT NULL,
  interview_kind               TEXT NOT NULL,
  interview_format             TEXT,
  scheduled_at                 TEXT,
  duration_minutes             INTEGER,
  interviewer_name             TEXT,
  prompt_version               TEXT NOT NULL,
  deterministic_json           TEXT NOT NULL,
  provider_status              TEXT NOT NULL DEFAULT 'not_requested'
                                 CHECK (provider_status IN ('not_requested','complete','failed')),
  provider_json                TEXT,
  provider                     TEXT,
  model                        TEXT,
  status                       TEXT NOT NULL CHECK (status IN ('preparing','ready','failed')),
  error                        TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at                 TEXT
);
CREATE INDEX idx_interview_preparations_claim ON interview_preparations(claim_id, id DESC);
CREATE INDEX idx_interview_preparations_interview ON interview_preparations(interview_id, id DESC);
CREATE INDEX idx_interview_preparations_source ON interview_preparations(source_input_hash, id DESC);

CREATE TABLE interview_preparation_artifacts (
  id             INTEGER PRIMARY KEY,
  preparation_id INTEGER NOT NULL REFERENCES interview_preparations(id),
  kind           TEXT NOT NULL,
  format         TEXT NOT NULL,
  path           TEXT NOT NULL,
  sha256         TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(preparation_id, path)
);
CREATE INDEX idx_interview_preparation_artifacts_preparation
  ON interview_preparation_artifacts(preparation_id, id);

CREATE TABLE interview_preparation_events (
  id             INTEGER PRIMARY KEY,
  preparation_id INTEGER NOT NULL REFERENCES interview_preparations(id),
  kind           TEXT NOT NULL,
  occurred_at    TEXT NOT NULL DEFAULT (datetime('now')),
  payload        TEXT
);
CREATE INDEX idx_interview_preparation_events_preparation
  ON interview_preparation_events(preparation_id, id);

PRAGMA user_version = 31;
