-- Prospect schema v29 — durable, lease-safe application package generation.
-- Existing claims are deliberately not backfilled. Deterministic audits become complete
-- independently of optional synthesis, whose state remains observable enrichment metadata.

ALTER TABLE job_listing_audits ADD COLUMN synthesis_status TEXT NOT NULL DEFAULT 'not_requested';
ALTER TABLE job_listing_audits ADD COLUMN synthesis_error TEXT;
ALTER TABLE job_listing_audits ADD COLUMN synthesis_completed_at TEXT;

UPDATE job_listing_audits
SET synthesis_status = CASE
      WHEN synthesis_json IS NOT NULL THEN 'complete'
      WHEN status = 'failed' THEN 'failed'
      WHEN status = 'pending' THEN 'failed'
      ELSE 'not_requested'
    END,
    synthesis_error = CASE
      WHEN status = 'failed' THEN error
      WHEN status = 'pending' THEN COALESCE(error, 'optional synthesis was interrupted before schema 29; request a fresh audit to retry')
      ELSE NULL
    END,
    synthesis_completed_at = CASE
      WHEN synthesis_json IS NOT NULL OR status IN ('failed','pending') THEN COALESCE(completed_at, created_at)
      ELSE NULL
    END,
    status = 'complete',
    completed_at = COALESCE(completed_at, created_at);

CREATE TABLE application_generation_jobs (
  id                           INTEGER PRIMARY KEY,
  request_key                  TEXT NOT NULL UNIQUE,
  source_input_hash            TEXT NOT NULL,
  trigger_kind                 TEXT NOT NULL,
  claim_id                     INTEGER NOT NULL REFERENCES claims(id),
  listing_id                   INTEGER NOT NULL REFERENCES listings(id),
  listing_snapshot_generation INTEGER NOT NULL,
  listing_snapshot_hash       TEXT NOT NULL,
  baseline_resume_version_id   INTEGER REFERENCES resume_versions(id),
  package_id                   INTEGER REFERENCES application_packages(id),
  status                       TEXT NOT NULL CHECK (status IN ('queued','auditing','drafting','rendering','needs_review','ready','failed')),
  provider                     TEXT,
  model                        TEXT,
  run_token                    TEXT UNIQUE,
  staging_path                 TEXT,
  response_token_match         INTEGER,
  attempts                     INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts                 INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  lease_owner                  TEXT,
  lease_expires_at             TEXT,
  next_attempt_at              TEXT,
  error                        TEXT,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                   TEXT NOT NULL DEFAULT (datetime('now')),
  started_at                   TEXT,
  completed_at                 TEXT
);
CREATE INDEX idx_application_generation_jobs_claim ON application_generation_jobs(claim_id, id DESC);
CREATE INDEX idx_application_generation_jobs_status ON application_generation_jobs(status, next_attempt_at, lease_expires_at, id);
CREATE INDEX idx_application_generation_jobs_package ON application_generation_jobs(package_id);

PRAGMA user_version = 29;
