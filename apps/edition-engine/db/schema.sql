-- PHAM Edition Engine / PostgreSQL reference schema
-- Edition 01 uses this schema, but all tables are edition-scoped for future releases.

create extension if not exists pgcrypto;

create table if not exists editions (
  id text primary key,
  slug text not null unique,
  label text not null,
  product_code text not null,
  state text not null check (state in (
    'prelaunch','reservation_open','reservation_full','final_payment','sold_out','archived'
  )),
  commerce_ready boolean not null default false,
  edition_size integer not null check (edition_size > 0),
  reservations_claimed integer not null default 0 check (reservations_claimed >= 0),
  identity_limit integer not null check (identity_limit > 0),
  identity_claimed integer not null default 0 check (identity_claimed >= 0),
  reservation_price_cents integer not null check (reservation_price_cents >= 0),
  final_price_cents integer not null check (final_price_cents >= 0),
  reservation_credit_cents integer not null check (reservation_credit_cents >= 0),
  payment_window_hours integer not null default 72 check (payment_window_hours > 0),
  standby_window_hours integer not null default 48 check (standby_window_hours > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reservations_claimed <= edition_size),
  check (identity_claimed <= identity_limit),
  check (reservation_credit_cents <= final_price_cents)
);

create table if not exists reservations (
  id text primary key,
  edition_id text not null references editions(id) on delete restrict,
  shopify_customer_id text not null,
  shopify_order_id text not null unique,
  status text not null check (status in (
    'active','final_payment_open','final_paid','expired','cancelled','fulfilled','archived'
  )),
  reservation_paid_cents integer not null check (reservation_paid_cents >= 0),
  balance_due_cents integer check (balance_due_cents is null or balance_due_cents >= 0),
  referral_code_used text,
  collector_referral_code text not null,
  paid_at timestamptz not null,
  final_payment_opened_at timestamptz,
  payment_deadline timestamptz,
  final_paid_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (edition_id, shopify_customer_id),
  unique (edition_id, collector_referral_code)
);

create table if not exists identity_privileges (
  reservation_id text primary key references reservations(id) on delete cascade,
  edition_id text not null references editions(id) on delete restrict,
  source text not null check (source in ('paid','referral')),
  status text not null check (status in (
    'claimed','configured','production_locked','fulfilled'
  )),
  alias text,
  inscription text,
  public_identity boolean not null default false,
  claimed_at timestamptz not null default now(),
  configured_at timestamptz,
  check (char_length(coalesce(alias,'')) <= 24),
  check (char_length(coalesce(inscription,'')) <= 40)
);

create table if not exists objects (
  id uuid primary key default gen_random_uuid(),
  edition_id text not null references editions(id) on delete restrict,
  object_number integer not null check (object_number > 0),
  reservation_id text unique references reservations(id) on delete set null,
  auth_token_hash text,
  provenance_status text not null default 'pending',
  founder_token_type text check (founder_token_type is null or founder_token_type in ('silver','gold')),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  unique (edition_id, object_number)
);

create table if not exists referral_conversions (
  id uuid primary key default gen_random_uuid(),
  edition_id text not null references editions(id) on delete restrict,
  referrer_reservation_id text not null references reservations(id) on delete cascade,
  referred_reservation_id text not null unique references reservations(id) on delete cascade,
  status text not null default 'verified' check (status in ('verified','revoked','review')),
  verified_at timestamptz not null default now(),
  check (referrer_reservation_id <> referred_reservation_id)
);

create table if not exists standby_entries (
  id uuid primary key default gen_random_uuid(),
  edition_id text not null references editions(id) on delete restrict,
  shopify_customer_id text not null,
  email text not null,
  country text,
  size_preference text,
  sequence bigint generated always as identity,
  status text not null default 'waiting' check (status in (
    'waiting','offered','converted','expired','removed'
  )),
  joined_at timestamptz not null default now(),
  promoted_at timestamptz,
  offer_deadline timestamptz,
  converted_order_id text,
  unique (edition_id, shopify_customer_id)
);

create index if not exists standby_fifo_idx
  on standby_entries (edition_id, sequence)
  where status = 'waiting';

create table if not exists edition_events (
  id bigint generated always as identity primary key,
  edition_id text references editions(id) on delete set null,
  reservation_id text references reservations(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Atomic reservation claim pattern:
-- begin;
-- select * from editions where id = $1 for update;
-- validate state/commerce_ready/reservations_claimed < edition_size;
-- update editions set reservations_claimed = reservations_claimed + 1 ...;
-- insert into reservations ...;
-- commit;
--
-- Atomic Identity claim follows the same pattern with identity_claimed < identity_limit.
-- Object-number allocation is protected by unique (edition_id, object_number).
-- Standby promotion should select the first waiting row FOR UPDATE SKIP LOCKED.
