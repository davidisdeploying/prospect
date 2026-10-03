-- migrations/010_llm_parse_status.sql
-- Prospect schema v10 — listings.llm_parse_status (ADDITIVE, never destructive). v9 -> v10.
-- Applied by server/migrate.js ONLY when user_version < 10, in a single transaction.
--
-- Why: server/llmParse.js (§5.3) had no status column of its own, so it borrowed
-- listings.enrichment_status — a column whose meaning belongs to server/enrich.js's
-- EMBEDDING lifecycle. That collision was not cosmetic:
--   1. llmParse's terminal 'skipped' (already-parsed, unchanged) OVERWROTE 'embedded'
--      on every service restart, because its boot backfill re-queues every listing with
--      a description. 9 of 15 live rows were stamped 'skipped'/'failed' while all 15
--      had a real listings_vec row + embedding_model — the column was lying.
--   2. enrich.js's own boot backfill selects `WHERE enrichment_status != 'embedded'`,
--      so those clobbered rows were needlessly re-embedded on the NEXT restart — real
--      repeat Ollama/GPU work on charlie, contending with Localworker's resident model.
--   3. llmParse's save-prevStatus/restore-on-success dance raced enrich.js: a ~36s LLM
--      call could restore a stale value over a concurrent 'embedded' write.
-- Giving llm-parse its OWN column removes all three. enrichment_status returns to
-- enrich.js as sole writer; llmParse.js never writes it again.
--
-- Backfill below is DERIVED FROM EVIDENCE ALREADY IN THE ROW, never guessed:
--   parsed.llm_parse.desc_hash == desc_hash  -> 'parsed'  (the authoritative completion
--                                               marker llmParse.js already relied on)
--   description IS NULL                      -> 'skipped' (nothing to parse, terminal)
--   otherwise                                -> NULL      (never attempted; honest absence)
-- Faithful-tracker: additive column only. No verbatim snapshot, raw_payload, snapshot_hash,
-- description, parsed, role_family or job_family value is read for a decision or written here.

ALTER TABLE listings ADD COLUMN llm_parse_status TEXT;

UPDATE listings
SET llm_parse_status = CASE
  WHEN parsed IS NOT NULL
   AND desc_hash IS NOT NULL
   AND json_extract(parsed, '$.llm_parse.desc_hash') = desc_hash THEN 'parsed'
  WHEN description IS NULL THEN 'skipped'
  ELSE NULL
END;

PRAGMA user_version = 10;
