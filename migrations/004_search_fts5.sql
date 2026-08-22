-- migrations/004_search_fts5.sql
-- Prospect schema v4 — FTS5 search (derived, read-only) + deferred desc_hash index. v3 -> v4.
--
-- listings_fts / claim_notes_fts are DERIVED SHADOWS: triggers write ONLY to the *_fts tables,
-- never to listings/claim_notes (faithful-tracker: the immutable snapshot is never touched).
-- Standalone FTS5 (no content= clause) — external-content breaks snippet()/highlight() on any
-- indexed column that isn't a literal column of the content table, and parsed_text (flattened
-- from listings.parsed JSON) is not a real listings column.
-- raw_payload is excluded from the index: verbatim scraped HTML/JSON, not human-searchable text.
--
-- parsed_text is built via a null-safe expression: listings.parsed is client-supplied and may be
-- NULL, absent $.sections, a non-JSON string, or $.sections of the wrong JSON type (a raw string
-- or number scalar) — json_each() on any of those throws "malformed JSON", which would abort the
-- whole listings INSERT/UPDATE (capture must never fail because of a search-indexing trigger).
-- json_valid() + json_type() gate json_each() so the trigger degrades to a NULL parsed_text
-- instead of raising.

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

-- listings' snapshot text itself is immutable, but `parsed`/enrichment_status/enriched_at are
-- written post-insert (linkRepost's UPDATE, future enrichment) so cover UPDATE for correctness.
-- Plain delete-by-rowid + re-insert from new.* (not the fts5 'delete' special-command, which would
-- require reconstructing old.parsed_text for no benefit on a standalone table).
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

-- claim_notes is append-only today (no PATCH/DELETE route in server/index.js) — AD kept for
-- safety/future-proofing only; no AU trigger since there is no update path to cover.
CREATE TRIGGER claim_notes_fts_ad AFTER DELETE ON claim_notes BEGIN
  DELETE FROM claim_notes_fts WHERE rowid = old.id;
END;

-- Deferred §3.3 (DP-F): equality-lookup index for repost detection
-- (server/repost.js: `WHERE l.desc_hash = @descHash`, currently unindexed). desc_hash stays
-- non-UNIQUE by design — a UNIQUE index would reject a legitimate re-survey snapshot.
CREATE INDEX idx_listings_desc_hash ON listings(desc_hash);

PRAGMA user_version = 4;
