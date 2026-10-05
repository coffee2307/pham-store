-- Bring databases created from 0001_initial.sql up to the current Worker schema.

ALTER TABLE editions ADD COLUMN design_origin TEXT NOT NULL DEFAULT 'DESIGNED IN VIETNAM / 2026';
ALTER TABLE editions ADD COLUMN production_origin TEXT NOT NULL DEFAULT 'PRODUCED IN DONGGUAN, CHINA';

ALTER TABLE reservations ADD COLUMN standby_id TEXT;

ALTER TABLE standby ADD COLUMN draft_order_id TEXT;
ALTER TABLE standby ADD COLUMN invoice_url TEXT;
ALTER TABLE standby ADD COLUMN converted_reservation_id TEXT;

-- Rebuild objects so qr_token has the same NOT NULL + UNIQUE guarantees as schema.sql.
ALTER TABLE objects RENAME TO objects_legacy_0002;

CREATE TABLE objects (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  object_number INTEGER NOT NULL,
  reservation_id TEXT UNIQUE,
  auth_token_hash TEXT UNIQUE NOT NULL,
  qr_token TEXT UNIQUE NOT NULL,
  provenance_status TEXT NOT NULL DEFAULT 'pending',
  token_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  UNIQUE (edition_id, object_number)
);

INSERT INTO objects (
  id,
  edition_id,
  object_number,
  reservation_id,
  auth_token_hash,
  qr_token,
  provenance_status,
  token_type,
  created_at,
  updated_at
)
SELECT
  id,
  edition_id,
  object_number,
  reservation_id,
  auth_token_hash,
  lower(hex(randomblob(32))),
  provenance_status,
  token_type,
  created_at,
  updated_at
FROM objects_legacy_0002;

DROP TABLE objects_legacy_0002;

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
