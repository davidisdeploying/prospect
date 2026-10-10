-- Migration 030: immutable, market-sourced salary guidance per captured listing
-- generation. Generation is application-owned so staking remains deterministic
-- from the versioned BLS snapshot and migration itself performs no inference.

CREATE TABLE salary_guidance (
  id                   INTEGER PRIMARY KEY,
  claim_id             INTEGER NOT NULL REFERENCES claims(id),
  listing_id           INTEGER NOT NULL UNIQUE REFERENCES listings(id),
  status               TEXT NOT NULL CHECK (status IN ('ready','unavailable')),
  area_code             TEXT NOT NULL,
  area_title            TEXT NOT NULL,
  data_period           TEXT NOT NULL,
  occupation_code       TEXT,
  occupation_title      TEXT,
  mapping_rule          TEXT NOT NULL,
  mapping_confidence    TEXT NOT NULL CHECK (mapping_confidence IN ('high','medium','none')),
  employment            INTEGER,
  annual_p25            INTEGER,
  annual_median         INTEGER,
  annual_p75            INTEGER,
  suggested_min         INTEGER,
  suggested_max         INTEGER,
  range_basis           TEXT,
  response_text         TEXT,
  unavailable_reason    TEXT,
  source_name           TEXT NOT NULL,
  source_url            TEXT NOT NULL,
  source_series_json    TEXT,
  source_retrieved_at   TEXT NOT NULL,
  dataset_sha256        TEXT NOT NULL,
  generated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_salary_guidance_claim ON salary_guidance(claim_id, id DESC);

PRAGMA user_version = 30;
