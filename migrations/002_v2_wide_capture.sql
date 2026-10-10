-- migrations/002_v2_wide_capture.sql
-- Prospect schema v2 — wide capture (ADDITIVE). Takes PRAGMA user_version 0 -> 2.
-- Applied by server/migrate.js ONLY when user_version < 2, in a single transaction. Never destructive.
-- Conventions: booleans are INTEGER 0/1; enum-like fields are TEXT validated in code (Phase 1.2), not via CHECK.
-- Model/adapter-written values are provenance-tagged INSIDE listings.parsed JSON as parsed_by in (adapter|llm|manual);
-- the verbatim listings snapshot (raw_payload) is never rewritten.

-- New normalized child tables ------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  canonical_name TEXT UNIQUE,
  page_url       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS resume_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes      TEXT
);

CREATE TABLE IF NOT EXISTS listing_skills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  skill      TEXT NOT NULL,
  tier       TEXT
);
CREATE INDEX IF NOT EXISTS idx_listing_skills_skill   ON listing_skills(skill);
CREATE INDEX IF NOT EXISTS idx_listing_skills_listing ON listing_skills(listing_id);

-- listings: wide capture (all nullable / defaulted; snapshot stays immutable) --
ALTER TABLE listings ADD COLUMN job_id TEXT;
ALTER TABLE listings ADD COLUMN company_id INTEGER REFERENCES companies(id);
ALTER TABLE listings ADD COLUMN employment_type TEXT;
ALTER TABLE listings ADD COLUMN workplace_type TEXT;
ALTER TABLE listings ADD COLUMN seniority TEXT;
ALTER TABLE listings ADD COLUMN role_family TEXT;
ALTER TABLE listings ADD COLUMN salary_min REAL;
ALTER TABLE listings ADD COLUMN salary_max REAL;
ALTER TABLE listings ADD COLUMN salary_period TEXT;
ALTER TABLE listings ADD COLUMN salary_currency TEXT;
ALTER TABLE listings ADD COLUMN comp_disclosed INTEGER;
ALTER TABLE listings ADD COLUMN annual_comp_min REAL;
ALTER TABLE listings ADD COLUMN annual_comp_max REAL;
ALTER TABLE listings ADD COLUMN annual_comp_mid REAL;
ALTER TABLE listings ADD COLUMN applicant_count INTEGER;
ALTER TABLE listings ADD COLUMN applicants_last_day INTEGER;
ALTER TABLE listings ADD COLUMN applicants_per_day REAL;
ALTER TABLE listings ADD COLUMN easy_apply INTEGER;
ALTER TABLE listings ADD COLUMN promoted INTEGER;
ALTER TABLE listings ADD COLUMN verified INTEGER;
ALTER TABLE listings ADD COLUMN actively_reviewing INTEGER;
ALTER TABLE listings ADD COLUMN top_applicant_match INTEGER;
ALTER TABLE listings ADD COLUMN location_city TEXT;
ALTER TABLE listings ADD COLUMN location_state TEXT;
ALTER TABLE listings ADD COLUMN location_metro TEXT;
ALTER TABLE listings ADD COLUMN posting_quality TEXT;
ALTER TABLE listings ADD COLUMN snapshot_generation INTEGER DEFAULT 1;
ALTER TABLE listings ADD COLUMN repost_of INTEGER REFERENCES listings(id);
ALTER TABLE listings ADD COLUMN desc_hash TEXT;
ALTER TABLE listings ADD COLUMN parsed TEXT;
ALTER TABLE listings ADD COLUMN desc_embedding BLOB;
ALTER TABLE listings ADD COLUMN enrichment_status TEXT DEFAULT 'raw';
ALTER TABLE listings ADD COLUMN enriched_at TEXT;

-- claims: apply-time context + the two-touchpoint fields ----------------------
ALTER TABLE claims ADD COLUMN applied_at TEXT;
ALTER TABLE claims ADD COLUMN stage_entered_at TEXT;
ALTER TABLE claims ADD COLUMN outcome_reason TEXT;
ALTER TABLE claims ADD COLUMN resume_version_id INTEGER REFERENCES resume_versions(id);
ALTER TABLE claims ADD COLUMN referral INTEGER;
ALTER TABLE claims ADD COLUMN cover_letter INTEGER;
ALTER TABLE claims ADD COLUMN application_minutes INTEGER;
ALTER TABLE claims ADD COLUMN gut_prediction REAL;
ALTER TABLE claims ADD COLUMN days_posted_at_apply INTEGER;

-- stage_transitions: why a move happened -------------------------------------
ALTER TABLE stage_transitions ADD COLUMN transition_cause TEXT;

-- contacts: hiring-poster linkage --------------------------------------------
ALTER TABLE contacts ADD COLUMN profile_url TEXT;
ALTER TABLE contacts ADD COLUMN is_job_poster INTEGER;

PRAGMA user_version = 2;
