-- Prospect schema v17 — per-device push preferences, quiet hours, and deferred delivery.

ALTER TABLE push_subscriptions
  ADD COLUMN scout_enabled INTEGER NOT NULL DEFAULT 1 CHECK (scout_enabled IN (0, 1));

ALTER TABLE push_subscriptions
  ADD COLUMN today_enabled INTEGER NOT NULL DEFAULT 1 CHECK (today_enabled IN (0, 1));

ALTER TABLE push_subscriptions
  ADD COLUMN quiet_hours_enabled INTEGER NOT NULL DEFAULT 1 CHECK (quiet_hours_enabled IN (0, 1));

ALTER TABLE push_subscriptions
  ADD COLUMN quiet_start TEXT NOT NULL DEFAULT '22:00'
    CHECK (
      quiet_start GLOB '[0-2][0-9]:[0-5][0-9]'
      AND CAST(substr(quiet_start, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    );

ALTER TABLE push_subscriptions
  ADD COLUMN quiet_end TEXT NOT NULL DEFAULT '07:00'
    CHECK (
      quiet_end GLOB '[0-2][0-9]:[0-5][0-9]'
      AND CAST(substr(quiet_end, 1, 2) AS INTEGER) BETWEEN 0 AND 23
    );

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

PRAGMA user_version = 17;
