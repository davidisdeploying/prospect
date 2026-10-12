-- migrations/011_resume_version_sends.sql
-- Prospect schema v11 — resume_version_sends (ADDITIVE, append-only). v10 -> v11.
-- Applied by server/migrate.js ONLY when user_version < 11, in a single transaction. Never destructive.
--
-- Why (H16, evicted from §6.7 advisor scope 2026-07-24): claims.resume_version_id is a single
-- nullable FK -- swapping it overwrites, with nothing recording the prior value or when a version
-- was sent. That means tailoring<->outcome correlation (any future §6.7 slice) cannot trust the
-- column retroactively. resume_versions currently holds 0 rows, so this is cheap now and only gets
-- more expensive the longer it waits.
--
-- claims.resume_version_id is left in place as the "current" pointer -- existing reads/patches keep
-- their exact shape. This table is the append-only ledger of every value it has ever taken, written
-- by server/resumeVersionSends.js from the same transaction as the PATCH that updates the column.
-- No backfill: resume_versions is empty and every live claims.resume_version_id is NULL, so there is
-- no prior send to reconstruct.

CREATE TABLE resume_version_sends (
  id                INTEGER PRIMARY KEY,
  claim_id          INTEGER NOT NULL REFERENCES claims(id),
  resume_version_id INTEGER REFERENCES resume_versions(id),
  sent_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resume_version_sends_claim ON resume_version_sends(claim_id);

PRAGMA user_version = 11;
