-- Prospect schema v28 — audited resume provenance and immutable application packages.

ALTER TABLE resume_versions ADD COLUMN kind TEXT;
ALTER TABLE resume_versions ADD COLUMN parent_resume_version_id INTEGER REFERENCES resume_versions(id);
ALTER TABLE resume_versions ADD COLUMN source_path TEXT;
ALTER TABLE resume_versions ADD COLUMN source_sha256 TEXT;
ALTER TABLE resume_versions ADD COLUMN style_reference_path TEXT;
ALTER TABLE resume_versions ADD COLUMN style_reference_sha256 TEXT;
ALTER TABLE resume_versions ADD COLUMN career_claims_sha256 TEXT;
ALTER TABLE resume_versions ADD COLUMN audit_status TEXT;
ALTER TABLE resume_versions ADD COLUMN audit_json TEXT;

CREATE TABLE application_packages (
  id                           INTEGER PRIMARY KEY,
  claim_id                     INTEGER NOT NULL REFERENCES claims(id),
  listing_id                   INTEGER NOT NULL REFERENCES listings(id),
  listing_snapshot_generation INTEGER NOT NULL,
  listing_snapshot_hash       TEXT NOT NULL,
  job_audit_id                 INTEGER NOT NULL REFERENCES job_listing_audits(id),
  baseline_resume_version_id   INTEGER NOT NULL REFERENCES resume_versions(id),
  career_claims_sha256         TEXT NOT NULL,
  career_claims_schema_version INTEGER NOT NULL,
  evidence_snapshot_json       TEXT NOT NULL,
  baseline_audit_json          TEXT NOT NULL,
  prompt_version               TEXT NOT NULL,
  brief_markdown               TEXT NOT NULL,
  created_at                   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_application_packages_claim ON application_packages(claim_id, id DESC);
CREATE INDEX idx_application_packages_listing ON application_packages(listing_id, id DESC);
CREATE INDEX idx_application_packages_audit ON application_packages(job_audit_id);

CREATE TABLE application_package_artifacts (
  id                INTEGER PRIMARY KEY,
  package_id        INTEGER NOT NULL REFERENCES application_packages(id),
  kind              TEXT NOT NULL,
  format            TEXT NOT NULL,
  path              TEXT NOT NULL,
  sha256            TEXT NOT NULL,
  resume_version_id INTEGER REFERENCES resume_versions(id),
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(package_id, path)
);
CREATE INDEX idx_application_package_artifacts_package ON application_package_artifacts(package_id, id);

CREATE TABLE application_package_events (
  id          INTEGER PRIMARY KEY,
  package_id  INTEGER NOT NULL REFERENCES application_packages(id),
  kind        TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  payload     TEXT
);
CREATE INDEX idx_application_package_events_package ON application_package_events(package_id, id);

PRAGMA user_version = 28;
