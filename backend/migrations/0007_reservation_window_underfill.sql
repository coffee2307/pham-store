-- PRELAUNCH-SAFE additive migration: existing edition stays with paid intake disabled.
ALTER TABLE editions ADD COLUMN reservation_window_days INTEGER NOT NULL DEFAULT 14;
ALTER TABLE editions ADD COLUMN reservation_opened_at TEXT;
ALTER TABLE editions ADD COLUMN reservation_closes_at TEXT;
ALTER TABLE editions ADD COLUMN reservation_closed_at TEXT;
ALTER TABLE editions ADD COLUMN reservation_close_reason TEXT;
ALTER TABLE editions ADD COLUMN release_quantity INTEGER NOT NULL DEFAULT 50;
ALTER TABLE editions ADD COLUMN partial_run_approved_at TEXT;
ALTER TABLE editions ADD COLUMN partial_run_reference TEXT;

CREATE TABLE IF NOT EXISTS refund_review_cases (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL UNIQUE,
  shopify_order_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  reason TEXT NOT NULL,
  settlement_reference TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  settled_at TEXT,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);

CREATE INDEX IF NOT EXISTS idx_refund_review_cases_edition
  ON refund_review_cases(edition_id, status);
