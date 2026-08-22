PRAGMA user_version = 27;

-- Prospect schema — v14 (Scout discovery inbox).
-- user_version = 15.
-- Corrected 2026-07-27 (H16 pass): this file had drifted stale at v8 -- migrations/009's claims
-- column (see the claims table below) was missing entirely, and the header undercounted
-- migrations/010 by two versions. Nothing live was affected (server/migrate.js always catches a
-- real db up via migrations/*.sql regardless of what this header claims), but a genuine fresh
-- install via this file alone would have booted two migrations behind. Fixed in the same pass as
-- H16 since both touch this file's head state.
-- Conventions:
--   * Booleans are INTEGER 0/1. Enum-like fields are TEXT, validated in code (not via CHECK) to keep migrations ADD-COLUMN-clean.
--   * listings is an IMMUTABLE verbatim snapshot (raw_payload); user notes/edits live elsewhere; re-survey = new snapshot_generation, never an edit.
--   * Model/adapter-derived values are provenance-tagged inside listings.parsed JSON as parsed_by in (adapter|llm|manual); never in the verbatim snapshot.
--   * Schema changes are additive migrations in migrations/NNN_*.sql, applied by server/migrate.js (keyed on PRAGMA user_version). Fresh installs run this file (already at v11).
--   * listings_fts / claim_notes_fts / listings_vec (this file) are DERIVED SHADOWS of listings/claim_notes,
--     kept in sync purely by triggers or application code — never a source of truth.
--   * listings_vec requires the vec0 extension to be loaded on the connection running this file
--     (server/vecExtension.js), or the CREATE VIRTUAL TABLE below fails with "no such module: vec0".

CREATE TABLE companies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  canonical_name TEXT UNIQUE,
  page_url       TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE resume_versions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  label      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes      TEXT,
  -- Added by migrations/024 (§5.4). Prospect held résumé LABELS but never résumé text, which
  -- made cosine(resume, JD) unbuildable rather than merely unbuilt. Nullable: a version with
  -- no text simply produces no resume_cosine prediction.
  body       TEXT
);

CREATE TABLE listings (
  id INTEGER PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT,
  captured_at TEXT NOT NULL DEFAULT (datetime('now')),
  raw_payload TEXT,
  company TEXT,
  role TEXT,
  location TEXT,
  comp TEXT,
  description TEXT,
  posted_at TEXT,
  snapshot_hash TEXT,
  job_id TEXT,
  company_id INTEGER REFERENCES companies(id),
  employment_type TEXT,
  workplace_type TEXT,
  seniority TEXT,
  role_family TEXT,
  salary_min REAL,
  salary_max REAL,
  salary_period TEXT,
  salary_currency TEXT,
  comp_disclosed INTEGER,
  annual_comp_min REAL,
  annual_comp_max REAL,
  annual_comp_mid REAL,
  applicant_count INTEGER,
  applicants_last_day INTEGER,
  applicants_per_day REAL,
  easy_apply INTEGER,
  promoted INTEGER,
  verified INTEGER,
  actively_reviewing INTEGER,
  top_applicant_match INTEGER,
  location_city TEXT,
  location_state TEXT,
  location_metro TEXT,
  posting_quality TEXT,
  snapshot_generation INTEGER DEFAULT 1,
  repost_of INTEGER REFERENCES listings(id),
  desc_hash TEXT,
  parsed TEXT,
  desc_embedding BLOB,
  enrichment_status TEXT DEFAULT 'raw',
  enriched_at TEXT,
  -- Added by migrations/005 (ALTER TABLE ADD COLUMN always appends; kept
  -- last here too so fresh-install column order matches the migrated order).
  external_job_id TEXT,
  apply_url TEXT,
  -- Added by migrations/006. embedding_model is provenance for listings_vec
  -- (below): which model produced the row's embedding, NULL until enriched.
  embedding_model TEXT,
  job_family TEXT,
  -- Added by migrations/010. llm-parse's OWN lifecycle signal (server/llmParse.js).
  -- Deliberately NOT enrichment_status: that column belongs to enrich.js's embedding
  -- lifecycle, and sharing it made llm-parse clobber 'embedded' on every restart.
  -- NULL = never attempted. Terminal values are stable across restarts.
  llm_parse_status TEXT,
  -- Added by migrations/012. skill-extraction's OWN lifecycle signal
  -- (server/skillExtract.js), same reasoning as llm_parse_status above applied a
  -- generation earlier: never share a status column across workers.
  -- NULL = never attempted. Terminal values are stable across restarts.
  skill_extract_status TEXT,
  -- Added by migrations/013. Posting-judgment advisor's OWN lifecycle signal
  -- (server/advise.js, §6.7.1), same reasoning as llm_parse_status/skill_extract_status
  -- above, one generation later: never share a status column across workers.
  -- NULL = never attempted. Terminal values are stable across restarts.
  advisor_status TEXT
);

CREATE TABLE listing_skills (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id INTEGER NOT NULL REFERENCES listings(id),
  skill      TEXT NOT NULL,
  tier       TEXT,
  -- Added by migrations/012. Provenance for skillExtract.js's own rows so a re-run's
  -- delete-then-insert only ever touches parsed_by='llm' rows, never a manually
  -- entered or adapter-scraped row. NULL preserves the meaning every pre-existing
  -- and future non-LLM row already has (mirrors listings.parsed.parsed_by's
  -- adapter|llm|manual vocabulary, documented above).
  parsed_by  TEXT,
  -- Added by migrations/012. The listings.desc_hash this LLM-derived row was
  -- extracted from (NULL for non-LLM rows) — lets skillExtract.js tell an
  -- unchanged listing apart from one whose description (and thus skills_prose)
  -- has since changed, without re-parsing listings.parsed each idempotency check.
  source_desc_hash TEXT
);
CREATE INDEX idx_listing_skills_skill   ON listing_skills(skill);
CREATE INDEX idx_listing_skills_listing ON listing_skills(listing_id);

-- Hunts (migration 023, §6.5) -- a job hunt ends, and multi-hunt archives are what make a second
-- search comparable to the first instead of a fresh start with no memory. `status` is validated in
-- code (ENUMS.hunt_status); ended_at is separate so a hunt can be paused or abandoned without
-- inventing an end date.
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

CREATE TABLE claims (
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
  -- Added by migrations/009.
  vendor_tracker_url TEXT,
  -- Added by migrations/023 (§6.5). Nullable on purpose: "which hunt was this?" must be
  -- answerable with "not recorded", and a NOT NULL default would erase the difference between a
  -- claim genuinely assigned to a hunt and one that was never asked.
  hunt_id INTEGER REFERENCES hunts(id)
);
CREATE TABLE claim_notes (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE stage_transitions (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  transitioned_at TEXT NOT NULL DEFAULT (datetime('now')),
  note TEXT,
  transition_cause TEXT,
  outcome_reason TEXT
);
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY,
  claim_id INTEGER NOT NULL REFERENCES claims(id),
  name TEXT,
  role TEXT,
  email TEXT,
  notes TEXT,
  profile_url TEXT,
  is_job_poster INTEGER
);

-- Search (migration 004) — standalone FTS5 shadow tables. See migrations/004_search_fts5.sql for
-- the full rationale (external-content vs standalone, null-safe parsed_text, trigger shape).

CREATE VIRTUAL TABLE listings_fts USING fts5(
  company, role, description, parsed_text,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER listings_fts_ai AFTER INSERT ON listings BEGIN
  INSERT INTO listings_fts(rowid, company, role, description, parsed_text)
  VALUES (
    new.id, new.company, new.role, new.description,
    CASE
      WHEN json_valid(new.parsed) AND json_type(new.parsed, '$.sections') IN ('object', 'array')
      THEN (SELECT group_concat(value, ' ') FROM json_each(json_extract(new.parsed, '$.sections')))
      ELSE NULL
    END
  );
END;

CREATE TRIGGER listings_fts_ad AFTER DELETE ON listings BEGIN
  DELETE FROM listings_fts WHERE rowid = old.id;
END;

CREATE TRIGGER listings_fts_au AFTER UPDATE ON listings BEGIN
  DELETE FROM listings_fts WHERE rowid = old.id;
  INSERT INTO listings_fts(rowid, company, role, description, parsed_text)
  VALUES (
    new.id, new.company, new.role, new.description,
    CASE
      WHEN json_valid(new.parsed) AND json_type(new.parsed, '$.sections') IN ('object', 'array')
      THEN (SELECT group_concat(value, ' ') FROM json_each(json_extract(new.parsed, '$.sections')))
      ELSE NULL
    END
  );
END;

CREATE VIRTUAL TABLE claim_notes_fts USING fts5(
  body,
  tokenize = 'porter unicode61'
);

CREATE TRIGGER claim_notes_fts_ai AFTER INSERT ON claim_notes BEGIN
  INSERT INTO claim_notes_fts(rowid, body) VALUES (new.id, new.body);
END;

CREATE TRIGGER claim_notes_fts_ad AFTER DELETE ON claim_notes BEGIN
  DELETE FROM claim_notes_fts WHERE rowid = old.id;
END;

CREATE INDEX idx_listings_desc_hash ON listings(desc_hash);

-- Embeddings (migration 006) — vec0 virtual table, populated by server/enrich.js
-- ONLY when PROSPECT_EMBEDDINGS is enabled (default OFF). listing_id is the
-- vec0 primary key (mirrors listings.id, not a foreign key — vec0 doesn't
-- support REFERENCES); embedding is a 768-dim float vector from the
-- nomic-embed-text model via Ollama's /api/embed. Never written from
-- listings.raw_payload/snapshot_hash directly — always derived, curated text.
CREATE VIRTUAL TABLE listings_vec USING vec0(listing_id INTEGER PRIMARY KEY, embedding FLOAT[768]);

-- Claim events (migration 008) — typed touchpoints (§3.4), additive + append-only, same shape as
-- stage_transitions/claim_notes: no UPDATE/DELETE route, kind validated in code (server/validate.js
-- ENUMS.claim_event_kind), payload is a nullable JSON TEXT column following listings.parsed's
-- precedent. See migrations/008_claim_events.sql for the full rationale.
CREATE TABLE claim_events (
  id          INTEGER PRIMARY KEY,
  claim_id    INTEGER NOT NULL REFERENCES claims(id),
  kind        TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  due_at      TEXT,
  payload     TEXT
);
CREATE INDEX idx_claim_events_claim   ON claim_events(claim_id);
CREATE INDEX idx_claim_events_due_at  ON claim_events(due_at);

-- Resume version sends (migration 011, H16) -- append-only per-send ledger. claims.resume_version_id
-- above stays the "current" pointer (unchanged read/patch shape); this table is what makes that
-- pointer's history trustworthy, since PATCHing the column overwrites it with nothing recording the
-- prior value or when a version was sent. Written by server/resumeVersionSends.js, called from the
-- same PATCH /api/claims/:id transaction that updates claims.resume_version_id. Same insert-only
-- shape as stage_transitions/claim_events: no UPDATE/DELETE route.
CREATE TABLE resume_version_sends (
  id                INTEGER PRIMARY KEY,
  claim_id          INTEGER NOT NULL REFERENCES claims(id),
  resume_version_id INTEGER REFERENCES resume_versions(id),
  sent_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resume_version_sends_claim ON resume_version_sends(claim_id);

-- Listing advisories (migration 013, §6.7.1) -- append-only stored output of the posting-judgment
-- advisor (server/advise.js), same insert-only shape as stage_transitions/claim_events/
-- resume_version_sends: no UPDATE/DELETE route. A listing can be re-advised across snapshot
-- generations (a re-survey changes desc_hash); every generation stays on record rather than
-- overwriting the prior one, per the §6.7 scoping lock's "stored, not ephemeral" decision.
-- listing_id's FK is plain REFERENCES with no delete clause, restrictive by default like every
-- other FK in this schema -- server/deleteClaim.js's hard-delete cascade deletes this table's
-- rows for a listing before the listing row itself, same as it already does for
-- listing_skills/listings_vec.
CREATE TABLE listing_advisories (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id   INTEGER NOT NULL REFERENCES listings(id),
  desc_hash    TEXT NOT NULL,
  model        TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  advisory     TEXT NOT NULL
);
CREATE INDEX idx_listing_advisories_listing ON listing_advisories(listing_id);

-- Scout (migration 014) — automatically discovered jobs stay outside listings/claims until David
-- deliberately captures one. Profile versions and sightings are append-only provenance; only
-- discovery review state and last-seen metadata are mutable.
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

-- Gmail ingestion receipts (migration 015) — one durable receipt per Gmail message makes the
-- background reader idempotent without modifying mailbox state. Message bodies are not retained.
CREATE TABLE scout_gmail_messages (
  gmail_message_id  TEXT PRIMARY KEY,
  gmail_thread_id   TEXT,
  received_at       TEXT,
  processed_at      TEXT NOT NULL DEFAULT (datetime('now')),
  status            TEXT NOT NULL CHECK (status IN ('imported','ignored','parse_empty','error')),
  job_count         INTEGER NOT NULL DEFAULT 0,
  detail            TEXT
);
CREATE INDEX idx_scout_gmail_messages_processed
  ON scout_gmail_messages(processed_at DESC);

-- Web Push subscriptions and delivery audit log (migration 016)
CREATE TABLE push_subscriptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  failure_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_success_at TEXT,
  last_failure_at TEXT,
  scout_enabled   INTEGER NOT NULL DEFAULT 1 CHECK (scout_enabled IN (0, 1)),
  today_enabled   INTEGER NOT NULL DEFAULT 1 CHECK (today_enabled IN (0, 1)),
  quiet_hours_enabled INTEGER NOT NULL DEFAULT 1 CHECK (quiet_hours_enabled IN (0, 1)),
  quiet_start     TEXT NOT NULL DEFAULT '22:00'
    CHECK (
      quiet_start GLOB '[0-2][0-9]:[0-5][0-9]'
      AND CAST(substr(quiet_start, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    ),
  quiet_end       TEXT NOT NULL DEFAULT '07:00'
    CHECK (
      quiet_end GLOB '[0-2][0-9]:[0-5][0-9]'
      AND CAST(substr(quiet_end, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    )
);

CREATE TABLE push_delivery_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kind            TEXT NOT NULL,
  event_key       TEXT,
  subscription_id INTEGER REFERENCES push_subscriptions(id) ,
  status          TEXT NOT NULL,
  status_code     INTEGER,
  detail          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_push_delivery_log_created_at
  ON push_delivery_log(created_at);

CREATE TABLE push_pending_notifications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  subscription_id INTEGER NOT NULL REFERENCES push_subscriptions(id),
  category        TEXT NOT NULL CHECK (category IN ('scout', 'today')),
  event_key       TEXT NOT NULL,
  payload         TEXT NOT NULL,
  urgency         TEXT NOT NULL DEFAULT 'normal',
  ttl             INTEGER NOT NULL DEFAULT 43200,
  not_before_ms   INTEGER NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at    TEXT,
  UNIQUE (subscription_id, event_key)
);

CREATE INDEX idx_push_pending_ready
  ON push_pending_notifications(delivered_at, not_before_ms);

-- Next-action commitments (migration 018, §6.3 honesty ledger) -- append-only ledger of every value
-- the mutable claims.next_action / claims.next_action_date pair has ever held. Same insert-only
-- shape and reasoning as resume_version_sends above: the columns stay the "current" pointer, and
-- this table is what makes that pointer honest retroactively. Written by
-- server/nextActionCommitments.js from the same transaction as the PATCH that updates the columns.
-- `event` is validated in code (COMMITMENT_EVENTS), per this schema's no-CHECK-on-enums convention.
CREATE TABLE next_action_commitments (
  id            INTEGER PRIMARY KEY,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  event         TEXT NOT NULL,
  action        TEXT,
  due_date      TEXT,
  prev_action   TEXT,
  prev_due_date TEXT,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_next_action_commitments_claim ON next_action_commitments(claim_id);
CREATE INDEX idx_next_action_commitments_recorded ON next_action_commitments(recorded_at);

-- Claim offers (migration 019, §6.1 Strike Sheet) -- append-only offer generations. An offer is
-- negotiated, so the first number and the final number are both real facts and the movement between
-- them only exists if the first was never overwritten. Components are stored separately and
-- annualized rather than blended, because "$85k plus a 10% bonus" and "$93.5k flat" total the same
-- and are not the same offer. `source` is validated in code (ENUMS.offer_source).
CREATE TABLE claim_offers (
  id            INTEGER PRIMARY KEY,
  claim_id      INTEGER NOT NULL REFERENCES claims(id),
  source        TEXT NOT NULL,
  base_annual   REAL,
  bonus_annual  REAL,
  equity_annual REAL,
  other_annual  REAL,
  currency      TEXT,
  note          TEXT,
  recorded_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claim_offers_claim ON claim_offers(claim_id, recorded_at);

-- Selection-process intelligence (migration 020, §6.4). Interviews are per claim; the question
-- bank and process artifacts hang off COMPANIES, because assessment formats and interview
-- questions recur per company and outlive any one application. Insert-only; kind vocabularies
-- are validated in code (ENUMS.interview_kind / ENUMS.artifact_kind).
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


-- Inbound outreach (migration 021, §6.6) -- claim-less recruiter leads. Contact-first: a thread
-- stands on its own, because the contacts table is claim-scoped and recording a lead would
-- otherwise mean inventing a claim for an application that was never made. converted_claim_id is
-- the ORIGIN EDGE, held on the thread so deleting a claim releases it and the outreach history
-- survives. Insert-only messages; vocabularies validated in code (ENUMS.outreach_*).
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


-- Vendor status observations (migration 022, §3.5b) -- what the EMPLOYER portal says, kept
-- strictly separate from claims.stage. The two disagree, and the disagreement is the signal;
-- nothing in server/vendorStatus.js ever writes claims.stage. status_text is verbatim,
-- normalized_status is a derived provenance-tagged interpretation (normalized_by), and an
-- unrecognized phrase stays NULL rather than being forced into the nearest bucket.
CREATE TABLE vendor_status_observations (
  id                INTEGER PRIMARY KEY,
  claim_id          INTEGER NOT NULL REFERENCES claims(id),
  vendor            TEXT,
  status_text       TEXT NOT NULL,
  normalized_status TEXT,
  normalized_by     TEXT,
  source_url        TEXT,
  note              TEXT,
  observed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_vendor_status_claim ON vendor_status_observations(claim_id, observed_at);


CREATE INDEX idx_claims_hunt ON claims(hunt_id);

-- Claim predictions (migration 024, §5.4) -- append-only forecast ledger. claims.gut_prediction is
-- mutable, so scoring it directly would measure hindsight: a forecast can be quietly revised once a
-- rejection lands. stage_at_prediction records where the claim stood when the forecast was made, so
-- server/calibration.js can exclude anything predicted after the outcome was already known. value is
-- always 0-1 so predictors are Brier-comparable; value_raw keeps the predictor's own units.
CREATE TABLE claim_predictions (
  id                  INTEGER PRIMARY KEY,
  claim_id            INTEGER NOT NULL REFERENCES claims(id),
  predictor           TEXT NOT NULL,
  value               REAL NOT NULL,
  value_raw           REAL,
  stage_at_prediction TEXT,
  model               TEXT,
  note                TEXT,
  recorded_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_claim_predictions_claim ON claim_predictions(claim_id, recorded_at);
CREATE INDEX idx_claim_predictions_predictor ON claim_predictions(predictor);

-- Advisor outputs (migration 025, §6.7.2/§6.7.3/§6.7.4) -- one append-only table for the three
-- remaining judgment slices. §6.7.1 has its own table because a posting judgment is ABOUT a listing
-- generation; these three are keyed differently (whole corpus, claim, claim) and share one shape:
-- "a model looked at X and said Y". input_hash is the idempotency key over the exact inputs, so an
-- unchanged re-run is a no-op and a changed input produces a NEW row rather than overwriting a
-- judgment. `slice` is validated in code (ADVISOR_SLICES).
CREATE TABLE advisor_outputs (
  id           INTEGER PRIMARY KEY,
  slice        TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id   INTEGER,
  input_hash   TEXT NOT NULL,
  model        TEXT NOT NULL,
  output       TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_advisor_outputs_slice ON advisor_outputs(slice, generated_at DESC);
CREATE INDEX idx_advisor_outputs_subject ON advisor_outputs(subject_type, subject_id);

-- Job listing audits (migration 027) are immutable audit generations. Deterministic
-- evidence and optional AI explanation live together, but failure of the latter never
-- erases the former.
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
