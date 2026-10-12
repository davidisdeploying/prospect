-- migrations/012_skill_extract.sql
-- Prospect schema v12 — skill-extraction lifecycle + provenance (ADDITIVE, never destructive). v11 -> v12.
-- Applied by server/migrate.js ONLY when user_version < 12, in a single transaction.
--
-- Why (§5.3(d)): server/skillExtract.js will populate the existing (currently empty)
-- listing_skills table from listings.parsed.llm_parse.skills_prose via LLM. Two gaps needed
-- closing before that worker could be written safely, both learned from migration 010's own
-- history (llm-parse borrowing enrichment_status and clobbering it every restart):
--
--   1. listings needs its OWN lifecycle column for this worker. Sharing enrichment_status or
--      llm_parse_status would repeat the exact collision migration 010 exists to fix — a status
--      write from one worker's boot backfill overwriting another worker's terminal state.
--      skill_extract_status is that column: NULL = never attempted, else one of
--      ('extracting','extracted','skipped','failed') — see validate.js ENUMS.
--
--   2. listing_skills has no provenance column at all (migrations/002 created it as
--      id/listing_id/skill/tier only). The manual/adapter capture path in server/index.js's
--      POST /api/claims already writes rows here with no tag. An LLM-driven backfill needs to
--      (a) know which rows it owns so a re-run's delete-then-insert never touches a manually
--      entered or adapter-scraped row, and (b) record which description snapshot a given
--      LLM-derived row came from, so a changed description can be told apart from an unchanged
--      one without re-deriving it from listings.parsed each time. parsed_by mirrors the existing
--      listings.parsed.parsed_by vocabulary (adapter|llm|manual) documented in schema.sql's
--      header; NULL preserves the meaning every pre-existing and future non-LLM row already has.
--
-- No backfill: this capability does not exist yet anywhere in the codebase as of this migration,
-- so there is no prior evidence to derive a status from (unlike migration 010, which could
-- recover 'parsed' from an already-written llm_parse.desc_hash match). Every listing's
-- skill_extract_status starts NULL (honestly "never attempted") and every listing_skills row
-- keeps parsed_by/source_desc_hash NULL until skillExtract.js actually runs.

ALTER TABLE listings ADD COLUMN skill_extract_status TEXT;
ALTER TABLE listing_skills ADD COLUMN parsed_by TEXT;
ALTER TABLE listing_skills ADD COLUMN source_desc_hash TEXT;

PRAGMA user_version = 12;
