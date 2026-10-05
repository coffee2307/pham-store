PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS editions (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  product_code TEXT NOT NULL,
  edition_size INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'prelaunch',
  reservation_price_cents INTEGER NOT NULL,
  final_price_cents INTEGER NOT NULL,
  identity_limit INTEGER NOT NULL,
  payment_window_hours INTEGER NOT NULL DEFAULT 72,
  standby_window_hours INTEGER NOT NULL DEFAULT 48,
  final_product_variant_id TEXT,
  currency_code TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  shopify_order_id TEXT UNIQUE NOT NULL,
  shopify_customer_id TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  reservation_paid_cents INTEGER NOT NULL,
  balance_due_cents INTEGER NOT NULL,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by_code TEXT,
  object_number INTEGER,
  payment_deadline TEXT,
  final_payment_status TEXT NOT NULL DEFAULT 'pending',
  digital_lookbook_status TEXT NOT NULL DEFAULT 'pending',
  final_draft_order_id TEXT,
  final_invoice_url TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  UNIQUE (edition_id, object_number)
);

CREATE TABLE IF NOT EXISTS identity_claims (
  reservation_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('paid','referral')),
  status TEXT NOT NULL DEFAULT 'claimed',
  preferred_number INTEGER,
  engraving_name TEXT,
  engraving_text TEXT,
  public_identity INTEGER NOT NULL DEFAULT 0,
  configured_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (edition_id) REFERENCES editions(id)
);

CREATE TABLE IF NOT EXISTS referrals (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  referrer_reservation_id TEXT NOT NULL,
  referred_reservation_id TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'verified',
  verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  FOREIGN KEY (referrer_reservation_id) REFERENCES reservations(id),
  FOREIGN KEY (referred_reservation_id) REFERENCES reservations(id)
);

CREATE TABLE IF NOT EXISTS standby (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  email TEXT NOT NULL,
  customer_id TEXT,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  promoted_at TEXT,
  offer_deadline TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  UNIQUE (edition_id, email),
  UNIQUE (edition_id, position)
);

CREATE TABLE IF NOT EXISTS objects (
  id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  object_number INTEGER NOT NULL,
  reservation_id TEXT UNIQUE,
  auth_token_hash TEXT UNIQUE NOT NULL,
  provenance_status TEXT NOT NULL DEFAULT 'pending',
  token_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (edition_id) REFERENCES editions(id),
  FOREIGN KEY (reservation_id) REFERENCES reservations(id),
  UNIQUE (edition_id, object_number)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  topic TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reservations_edition_status
  ON reservations(edition_id, status);

CREATE INDEX IF NOT EXISTS idx_reservations_referral_code
  ON reservations(referral_code);

CREATE INDEX IF NOT EXISTS idx_standby_queue
  ON standby(edition_id, status, position);

INSERT OR IGNORE INTO editions (
  id, label, product_code, edition_size, state,
  reservation_price_cents, final_price_cents, identity_limit,
  payment_window_hours, standby_window_hours,
  final_product_variant_id, currency_code
) VALUES (
  'edition-01', 'EDITION 01', 'PHAM-001', 50, 'prelaunch',
  2499, 19900, 15, 72, 48,
  'gid://shopify/ProductVariant/50501819662592', 'USD'
);
