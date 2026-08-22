-- migrations/020_selection_intel.sql
-- Prospect schema v20 — selection-process intelligence (ADDITIVE, append-only). v19 -> v20.
-- Applied by server/migrate.js ONLY when user_version < 20, in a single transaction. Never destructive.
--
-- Why (§6.4, widened 2026-07-18 from "interview log + question bank"): the motivating case is on
-- record. Claim #1's application day ran a full employer gauntlet — tracker email, a hard two-week
-- assessment deadline, a four-section assessment, a submitted confirmation — and none of it was
-- visible to the tracker. §3.4 claim_events fixed the touchpoint half: that a thing happened, and
-- when it was due. This migration is the other half: WHAT the thing actually was, so the second
-- time a company runs the same process it is a known quantity instead of a fresh surprise.
--
-- Three tables, because the three things have genuinely different lifetimes:
--
-- interviews    — per claim. One row per conversation or assessment sitting. Scheduled and occurred
--                 are separate columns: an interview that was scheduled and never happened is a
--                 real and interesting outcome, and collapsing them would erase it.
--
-- interview_questions — the question bank. claim_id is where it was asked; company_id is why it is
--                 worth keeping, since interview questions recur per company far more reliably than
--                 they recur per role. interview_id is nullable on purpose: a question remembered
--                 later, with no sitting to attach it to, is still worth banking, and forcing a
--                 fake parent row to hold it would be worse than allowing the null.
--
-- company_process_artifacts — company-scoped, NOT claim-scoped. This is the §6.4 insight: assessment
--                 formats recur per company, so the durable record belongs to the company and
--                 outlives any one application. source_claim_id records where it was first learned
--                 without binding the artifact's life to that claim.
--
-- All three are insert-only in the same sense as the rest of this schema's ledgers. `kind` and
-- `format` vocabularies are validated in code (ENUMS.interview_kind / ENUMS.artifact_kind), per the
-- no-CHECK-on-enums convention.
--
-- No YAML ingester and no document store: at this corpus the durable concept is the claim/company
-- document, and `body` as TEXT is the honest version of that. A file-backed artifact store can be
-- added later without changing these keys.

CREATE TABLE interviews (
  id           INTEGER PRIMARY KEY,
  claim_id     INTEGER NOT NULL REFERENCES claims(id),
  kind         TEXT NOT NULL,
  format       TEXT,
  scheduled_at TEXT,
  occurred_at  TEXT,
  duration_minutes INTEGER,
  contact_id   INTEGER REFERENCES contacts(id),
  outcome_note TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_interviews_claim ON interviews(claim_id);

CREATE TABLE interview_questions (
  id           INTEGER PRIMARY KEY,
  claim_id     INTEGER REFERENCES claims(id),
  company_id   INTEGER REFERENCES companies(id),
  interview_id INTEGER REFERENCES interviews(id),
  question     TEXT NOT NULL,
  category     TEXT,
  asked_by     TEXT,
  answer_note  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_interview_questions_company ON interview_questions(company_id);
CREATE INDEX idx_interview_questions_claim ON interview_questions(claim_id);

CREATE TABLE company_process_artifacts (
  id              INTEGER PRIMARY KEY,
  company_id      INTEGER NOT NULL REFERENCES companies(id),
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT,
  reference_path  TEXT,
  source_claim_id INTEGER REFERENCES claims(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_company_process_artifacts_company ON company_process_artifacts(company_id);

PRAGMA user_version = 20;
