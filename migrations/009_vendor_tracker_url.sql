-- migrations/009_vendor_tracker_url.sql
-- Prospect schema v9 — claims.vendor_tracker_url (ADDITIVE, never destructive). v8 -> v9.
-- Applied by server/migrate.js ONLY when user_version < 9, in a single transaction. Never destructive.
-- Why: §3.5(a) jump-link field so David can hop straight to the vendor's own tracker page
-- for a claim, instead of hunting for it manually.

ALTER TABLE claims ADD COLUMN vendor_tracker_url TEXT;

PRAGMA user_version = 9;
