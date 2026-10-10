-- Prospect schema v15 — durable, read-only Gmail ingestion receipts.
--
-- The importer never changes mailbox state. This table records only Gmail message/thread IDs,
-- processing status, counts, and bounded diagnostics so scheduled runs are idempotent without
-- retaining message bodies.

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

PRAGMA user_version = 15;
