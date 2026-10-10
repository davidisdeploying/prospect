-- migrations/006_embedding_vec0.sql
-- Prospect schema v6 — sqlite-vec infra for listing embeddings (Phase 5 §5.1, ADDITIVE). v5 -> v6.
-- Applied by server/migrate.js ONLY when user_version < 6, in a single transaction. Never destructive.
-- listings_vec is a DERIVED vec0 virtual table (+ its own shadow tables, e.g. *_chunks/*_rowids/*_info):
-- embeddings live here, never in listings.raw_payload/snapshot_hash (faithful-tracker: the immutable
-- verbatim snapshot is never touched by embedding work). embedding_model is a nullable provenance
-- column on listings, following the same additive ALTER-COLUMN pattern as migrations 002/005.
-- The vec0 extension must already be loaded on this connection (server/db.js's loadVecExtension),
-- or this CREATE VIRTUAL TABLE fails with "no such module: vec0".

CREATE VIRTUAL TABLE IF NOT EXISTS listings_vec USING vec0(listing_id INTEGER PRIMARY KEY, embedding FLOAT[768]);

ALTER TABLE listings ADD COLUMN embedding_model TEXT;

PRAGMA user_version = 6;
