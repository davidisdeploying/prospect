-- migrations/014_scout.sql
-- Prospect schema v14 — Scout discovery inbox.
--
-- Scout keeps automatically discovered jobs outside the faithful application tracker. A job
-- becomes a listing/claim only after David opens it and deliberately uses Prospect Capture.
-- Candidate profiles and source sightings are append-only; review state on the discovery row is
-- the only mutable workflow state.

CREATE TABLE scout_profile_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  label        TEXT NOT NULL,
  profile_json TEXT NOT NULL,
  profile_hash TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE scout_discoveries (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  source               TEXT NOT NULL,
  source_key           TEXT NOT NULL,
  external_job_id      TEXT,
  source_url           TEXT NOT NULL,
  apply_url            TEXT,
  company              TEXT,
  role                 TEXT NOT NULL,
  location             TEXT,
  description          TEXT,
  posted_at             TEXT,
  first_seen_at        TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at         TEXT NOT NULL DEFAULT (datetime('now')),
  status               TEXT NOT NULL DEFAULT 'new'
                         CHECK (status IN ('new','shortlisted','dismissed','captured')),
  profile_version_id   INTEGER REFERENCES scout_profile_versions(id),
  fit_score            INTEGER NOT NULL,
  fit_label            TEXT NOT NULL,
  assessment_json      TEXT NOT NULL,
  linked_claim_id      INTEGER REFERENCES claims(id),
  UNIQUE(source, source_key)
);
CREATE INDEX idx_scout_discoveries_review
  ON scout_discoveries(status, fit_score DESC, first_seen_at DESC);
CREATE INDEX idx_scout_discoveries_external_job_id
  ON scout_discoveries(external_job_id);

CREATE TABLE scout_sightings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  discovery_id  INTEGER NOT NULL REFERENCES scout_discoveries(id),
  seen_at       TEXT NOT NULL DEFAULT (datetime('now')),
  message_id    TEXT,
  raw_payload   TEXT NOT NULL,
  snapshot_hash TEXT NOT NULL UNIQUE
);
CREATE INDEX idx_scout_sightings_discovery ON scout_sightings(discovery_id);

PRAGMA user_version = 14;
