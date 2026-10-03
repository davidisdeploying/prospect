-- Prospect schema v32 - bounded agent research for interview preparation.
--
-- The deterministic guide remains immediately usable. A durable background job may enrich
-- it with source-linked public company, role, and interview research through Tower.

ALTER TABLE interview_preparations ADD COLUMN provider_error TEXT;

CREATE TABLE interview_research_jobs (
  id                   INTEGER PRIMARY KEY,
  request_key          TEXT NOT NULL UNIQUE,
  source_input_hash    TEXT NOT NULL,
  preparation_id       INTEGER NOT NULL REFERENCES interview_preparations(id),
  claim_id             INTEGER NOT NULL REFERENCES claims(id),
  listing_id           INTEGER NOT NULL REFERENCES listings(id),
  status               TEXT NOT NULL CHECK (status IN ('queued','researching','ready','failed')),
  provider             TEXT,
  model                TEXT,
  run_token            TEXT UNIQUE,
  staging_path         TEXT,
  response_token_match INTEGER,
  attempts             INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts         INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner          TEXT,
  lease_expires_at     TEXT,
  next_attempt_at      TEXT,
  error                TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  started_at           TEXT,
  completed_at         TEXT
);
CREATE INDEX idx_interview_research_jobs_preparation ON interview_research_jobs(preparation_id, id DESC);
CREATE INDEX idx_interview_research_jobs_claim ON interview_research_jobs(claim_id, id DESC);
CREATE INDEX idx_interview_research_jobs_status ON interview_research_jobs(status, next_attempt_at, lease_expires_at, id);

PRAGMA user_version = 32;
