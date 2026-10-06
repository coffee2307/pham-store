-- PHAM object lifecycle and immutable Founder’s Token allocation metadata.
-- Forward-only migration for databases that already applied 0001_initial.sql.

ALTER TABLE editions ADD COLUMN founder_tokens_allocated_at TEXT;
ALTER TABLE editions ADD COLUMN founder_token_gold_object_number INTEGER;
ALTER TABLE editions ADD COLUMN founder_token_allocation_method TEXT;

ALTER TABLE reservations ADD COLUMN acquired_at TEXT;
ALTER TABLE reservations ADD COLUMN lifecycle_stage TEXT NOT NULL DEFAULT 'not_started';
ALTER TABLE reservations ADD COLUMN lifecycle_updated_at TEXT;
ALTER TABLE reservations ADD COLUMN carrier TEXT;
ALTER TABLE reservations ADD COLUMN tracking_number TEXT;
ALTER TABLE reservations ADD COLUMN tracking_url TEXT;

CREATE TABLE IF NOT EXISTS object_lifecycle_events (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  note TEXT,
  carrier TEXT,
  tracking_number TEXT,
  tracking_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id)
);

CREATE INDEX IF NOT EXISTS idx_object_lifecycle_reservation
  ON object_lifecycle_events(reservation_id, created_at);

-- Existing completed acquisitions, if any, enter the post-acquisition workflow here.
UPDATE reservations
SET lifecycle_stage = 'production_queued',
    acquired_at = COALESCE(acquired_at, updated_at, created_at),
    lifecycle_updated_at = COALESCE(lifecycle_updated_at, updated_at, created_at)
WHERE status = 'final_paid' AND lifecycle_stage = 'not_started';
