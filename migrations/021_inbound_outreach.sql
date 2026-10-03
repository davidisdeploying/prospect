-- migrations/021_inbound_outreach.sql
-- Prospect schema v21 — inbound outreach without a claim (ADDITIVE, append-only). v20 -> v21.
-- Applied by server/migrate.js ONLY when user_version < 21, in a single transaction. Never destructive.
--
-- Why (§6.6, registered 2026-07-18): a recruiter approached David with NO application attached — a
-- different Amazon role and location, the same week as claim #1. Prospect had nowhere to put it.
-- The existing contacts table is claim-scoped (claim_id NOT NULL), so recording a claim-less lead
-- would have meant either inventing a claim for an application that was never made — which is
-- exactly the kind of fiction the faithful-tracker rule exists to prevent — or losing the lead.
--
-- outreach_threads is therefore contact-first: a thread stands on its own, with company_id when the
-- company is already known and a plain company_name when it is not. Nothing here requires a claim.
--
-- THE ORIGIN EDGE is the point of the section. When a thread turns into a real requisition,
-- converted_claim_id records that this claim began as inbound outreach rather than as a search hit,
-- which is a source-attribution datapoint the Hunt Report can use ("how many live applications
-- came to me versus how many I found?"). The edge lives on the THREAD, not on the claim, so that
-- deleting a claim releases the edge to NULL and the outreach history survives — the same posture
-- as §6.4's company_process_artifacts and Scout's linked_claim_id.
--
-- outreach_messages is the append-only thread log, same insert-only shape as every other ledger
-- here. `direction` and `status` vocabularies are validated in code (ENUMS.outreach_direction /
-- ENUMS.outreach_status), per the no-CHECK-on-enums convention.

CREATE TABLE outreach_threads (
  id                  INTEGER PRIMARY KEY,
  company_id          INTEGER REFERENCES companies(id),
  company_name        TEXT,
  contact_name        TEXT,
  contact_role        TEXT,
  contact_email       TEXT,
  contact_profile_url TEXT,
  channel             TEXT,
  role_pitched        TEXT,
  location            TEXT,
  status              TEXT NOT NULL DEFAULT 'open',
  converted_claim_id  INTEGER REFERENCES claims(id),
  first_contact_at    TEXT NOT NULL DEFAULT (datetime('now')),
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outreach_threads_company ON outreach_threads(company_id);
CREATE INDEX idx_outreach_threads_status ON outreach_threads(status);
CREATE INDEX idx_outreach_threads_claim ON outreach_threads(converted_claim_id);

CREATE TABLE outreach_messages (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER NOT NULL REFERENCES outreach_threads(id),
  direction   TEXT NOT NULL,
  body        TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_outreach_messages_thread ON outreach_messages(thread_id, occurred_at);

PRAGMA user_version = 21;
