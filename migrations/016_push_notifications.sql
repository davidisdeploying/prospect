-- Prospect schema v16 — Web Push subscriptions and delivery audit log.

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
  last_failure_at TEXT
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

PRAGMA user_version = 16;
