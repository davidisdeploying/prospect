-- migrations/023_hunts.sql
-- Prospect schema v23 — hunts and multi-hunt archives (ADDITIVE). v22 -> v23.
-- Applied by server/migrate.js ONLY when user_version < 23, in a single transaction. Never destructive.
--
-- Why (§6.5): a job hunt ends. Right now Prospect has no concept of that, so the day David takes a
-- job every claim from this search stays mixed in with whatever he does next, and the one question
-- worth asking at the end — what did this hunt actually cost and teach — has no boundary to ask it
-- within. A hunt is that boundary, and multi-hunt archives are what make a second search comparable
-- to the first instead of a fresh start with no memory.
--
-- claims.hunt_id is an additive nullable column, following migrations/005 and 009's ALTER-COLUMN
-- pattern. Nullable rather than NOT NULL DEFAULT 1 on purpose: "which hunt was this?" must be
-- answerable with "not recorded" for anything created before hunts existed, and a NOT NULL default
-- would erase the difference between a claim genuinely assigned to hunt 1 and one that was simply
-- never asked.
--
-- The backfill below is the one exception, and it is deliberate rather than incidental. Every claim
-- in the live database belongs to a single continuous search that is still running, which is a fact
-- about this data and not an assumption about data in general — so those rows are assigned to that
-- hunt explicitly. It adds a grouping and destroys nothing: hunt_id can be set back to NULL, and no
-- existing column is read or rewritten.
--
-- `status` is validated in code (ENUMS.hunt_status). A hunt with ended_at set is closed; the column
-- exists so a hunt can also be abandoned or paused without inventing an end date for it.

CREATE TABLE hunts (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  goal         TEXT,
  status       TEXT NOT NULL DEFAULT 'active',
  started_at   TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at     TEXT,
  outcome_note TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_hunts_status ON hunts(status);

ALTER TABLE claims ADD COLUMN hunt_id INTEGER REFERENCES hunts(id);
CREATE INDEX idx_claims_hunt ON claims(hunt_id);

-- The current search, dated from the earliest claim rather than from "now" so the hunt's duration
-- is true rather than starting the day this migration happened to run.
INSERT INTO hunts (name, status, started_at, goal)
SELECT
  'Current hunt',
  'active',
  COALESCE((SELECT MIN(created_at) FROM claims), datetime('now')),
  'The search in progress when multi-hunt archives were introduced.'
WHERE EXISTS (SELECT 1 FROM claims);

UPDATE claims SET hunt_id = (SELECT id FROM hunts ORDER BY id LIMIT 1)
WHERE hunt_id IS NULL AND EXISTS (SELECT 1 FROM hunts);

PRAGMA user_version = 23;
