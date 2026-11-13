-- Delivery claims are separate from merely granting a lookbook entitlement.
ALTER TABLE reservations ADD COLUMN lookbook_delivery_reference TEXT;
ALTER TABLE reservations ADD COLUMN lookbook_delivery_confirmed_at TEXT;
-- Private transaction-only notices; never embed email addresses in job identifiers.
CREATE TABLE IF NOT EXISTS customer_notification_jobs (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);
CREATE INDEX IF NOT EXISTS idx_notifications_outbox
  ON customer_notification_jobs(status,created_at);
