-- Migration 026: tighten claims.stage to the current stage model.
-- Fails closed if any existing stage falls outside that model.
-- Preserves all columns, FKs, rows, indexes, and triggers.

-- migrate.js starts this transaction with foreign_keys ON. That setting cannot
-- change mid-transaction, so defer checks until the rebuilt parent is renamed.
PRAGMA defer_foreign_keys = ON;

CREATE TEMP TABLE _stage_constraint_check (id INTEGER CHECK (id = 0));
INSERT INTO _stage_constraint_check
SELECT COUNT(*) FROM claims
WHERE stage NOT IN ('Showings','Staked','Working the Vein','Strike','Tailings');
DROP TABLE _stage_constraint_check;

CREATE TABLE claims_new (
  id INTEGER PRIMARY KEY,
  listing_id INTEGER REFERENCES listings(id),
  stage TEXT NOT NULL DEFAULT 'Showings'
    CHECK (stage IN ('Showings','Staked','Working the Vein','Strike','Tailings')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  next_action TEXT,
  next_action_date TEXT,
  applied_at TEXT,
  stage_entered_at TEXT,
  outcome_reason TEXT,
  resume_version_id INTEGER REFERENCES resume_versions(id),
  referral INTEGER,
  cover_letter INTEGER,
  application_minutes INTEGER,
  gut_prediction REAL,
  days_posted_at_apply INTEGER,
  vendor_tracker_url TEXT,
  hunt_id INTEGER REFERENCES hunts(id)
);

INSERT INTO claims_new (
  id, listing_id, stage, created_at, updated_at, next_action, next_action_date,
  applied_at, stage_entered_at, outcome_reason, resume_version_id, referral,
  cover_letter, application_minutes, gut_prediction, days_posted_at_apply,
  vendor_tracker_url, hunt_id
)
SELECT
  id, listing_id, stage, created_at, updated_at, next_action, next_action_date,
  applied_at, stage_entered_at, outcome_reason, resume_version_id, referral,
  cover_letter, application_minutes, gut_prediction, days_posted_at_apply,
  vendor_tracker_url, hunt_id
FROM claims;

DROP TABLE claims;
ALTER TABLE claims_new RENAME TO claims;

CREATE INDEX idx_claims_hunt ON claims(hunt_id);

-- Restore immediate checks before COMMIT; this makes SQLite validate the final graph.
PRAGMA defer_foreign_keys = OFF;
PRAGMA user_version = 26;
