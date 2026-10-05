ALTER TABLE reservations ADD COLUMN standby_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_standby_id
  ON reservations(standby_id)
  WHERE standby_id IS NOT NULL;

ALTER TABLE standby ADD COLUMN draft_order_id TEXT;
ALTER TABLE standby ADD COLUMN invoice_url TEXT;
ALTER TABLE standby ADD COLUMN converted_reservation_id TEXT;
