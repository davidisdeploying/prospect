-- Prospect schema v27 — append-only, evidence-grounded job listing audits.
-- Every run records the exact listing generation, Career source hash, deterministic
-- requirement matrix, optional model synthesis, and market-corpus snapshot.

CREATE TABLE job_listing_audits (
  id                 INTEGER PRIMARY KEY,
  listing_id         INTEGER NOT NULL REFERENCES listings(id),
  claim_id           INTEGER REFERENCES claims(id),
  listing_desc_hash  TEXT NOT NULL,
  career_source_path TEXT NOT NULL,
  career_claims_hash TEXT NOT NULL,
  resume_version_id  INTEGER REFERENCES resume_versions(id),
  prompt_version     TEXT NOT NULL,
  input_hash         TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL,
  deterministic_json TEXT NOT NULL,
  synthesis_json     TEXT,
  model              TEXT,
  error              TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at       TEXT
);
CREATE INDEX idx_job_listing_audits_listing ON job_listing_audits(listing_id, id DESC);
CREATE INDEX idx_job_listing_audits_claim ON job_listing_audits(claim_id, id DESC);

PRAGMA user_version = 27;
