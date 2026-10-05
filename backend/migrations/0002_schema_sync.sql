-- Bring databases created from 0001_initial.sql up to the current Worker schema.

ALTER TABLE editions ADD COLUMN design_origin TEXT NOT NULL DEFAULT 'DESIGNED IN VIETNAM / 2026';
ALTER TABLE editions ADD COLUMN production_origin TEXT NOT NULL DEFAULT 'PRODUCED IN DONGGUAN, CHINA';

ALTER TABLE reservations ADD COLUMN standby_id TEXT;

ALTER TABLE standby ADD COLUMN draft_order_id TEXT;
ALTER TABLE standby ADD COLUMN invoice_url TEXT;
ALTER TABLE standby ADD COLUMN converted_reservation_id TEXT;

-- SQLite/D1 cannot add a NOT NULL UNIQUE column to a populated table directly.
-- Add it nullable, backfill any historical rows, then enforce uniqueness with an index.
ALTER TABLE objects ADD COLUMN qr_token TEXT;
UPDATE objects
SET qr_token = lower(hex(randomblob(32)))
WHERE qr_token IS NULL OR qr_token = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_objects_qr_token
  ON objects(qr_token);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_standby_id
  ON reservations(standby_id)
  WHERE standby_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_standby_converted_reservation
  ON standby(converted_reservation_id)
  WHERE converted_reservation_id IS NOT NULL;

UPDATE editions
SET
  design_origin = COALESCE(NULLIF(design_origin, ''), 'DESIGNED IN VIETNAM / 2026'),
  production_origin = COALESCE(NULLIF(production_origin, ''), 'PRODUCED IN DONGGUAN, CHINA'),
  updated_at = CURRENT_TIMESTAMP;
