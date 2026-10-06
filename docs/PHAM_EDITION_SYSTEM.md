# PHAM Edition Release System

## Purpose

PHAM uses one reusable release architecture for numbered editions. Edition 01 begins with PHAM-001, but the same engine, collector record, lifecycle and archive model must support later editions without hard-coded product logic.

The brand protocol is:

**ACCESS → ORDER → PRODUCTION → DELIVERY → ARCHIVE**

Reservation, Identity, referral and provenance are mechanisms inside that protocol; they are not separate brand journeys.

## Edition state machine

D1 is the authority for campaign state:

1. `prelaunch`
2. `reservation_open`
3. `reservation_full`
4. `final_payment`
5. `sold_out`
6. `archived`

Theme Settings remain a presentation fallback. When the Edition Engine is enabled, the Worker/D1 state is authoritative and checkout fails closed if live state cannot be verified.

## Edition 01 commercial defaults

- Edition size: 50 objects
- Priority Reservation: $24.99
- Final object price: $199.00
- Reserved-collector balance: $174.01
- Object Identity upgrade: $5.00
- Identity privilege pool: 15 total
- Identity unlock: paid upgrade OR one verified successful reservation referral
- Final-payment window: 72 hours
- Standby: free FIFO queue
- Standby acquisition: full $199.00
- Standby offer window: 48 hours
- Canonical size set for PHAM-001 / Edition 01: M / L / XL / XXL
- Edition 01 final SKU pattern: `PHAM-001-E01-M|L|XL|XXL`
- Final invoice variant: exact Shopify variant matching the stored Size Preference

## Object lifecycle

Campaign state and physical object lifecycle are deliberately separate.

Once final acquisition payment is validated, a reservation becomes `final_paid` and enters:

1. `production_queued`
2. `in_production`
3. `quality_control`
4. `packed`
5. `dispatched`
6. `delivered`
7. `archived`

`not_started` exists only before final acquisition.

Lifecycle transitions are forward-only and one stage at a time. The normal lifecycle endpoint cannot set `archived`; archival is an edition-level action and is allowed only when the archive gate passes.

Every transition is written to `object_lifecycle_events` so the current state and the historical sequence are both retained.

## Shopify fulfillment bridge

PHAM subscribes to:

- `ORDERS_PAID`
- `FULFILLMENTS_CREATE`
- `FULFILLMENTS_UPDATE`

Fulfillment webhooks do not bypass PHAM lifecycle rules.

- Tracking on a `packed` object can advance it to `dispatched`.
- Shopify shipment status `delivered` can advance only `dispatched → delivered`.
- A fulfillment event that would skip Production, QC or Packing is written to the review queue instead of changing state.
- Tracking changes after dispatch can update the collector record without rewinding or skipping lifecycle state.

Manual operator lifecycle commands remain available as a controlled recovery path.

## Collector Access

Collector Access is a private object record, not a generic order-status page.

It can expose to the authenticated collector:

- edition and product code;
- reservation/acquisition state;
- numbered object assignment;
- acquisition timestamp;
- Size Preference;
- Object Identity status;
- production/delivery lifecycle;
- tracking information;
- digital lookbook status;
- referral progress;
- Founder’s Token reveal state;
- Birth Record link;
- final-payment action while the payment window is open.

The Worker remains the live source of truth; Shopify customer metafields are the storefront fallback.

## Birth Record / provenance

After Edition finalization, each acquired object receives an `objects` record with:

- permanent object ID;
- edition and object number;
- reservation binding;
- unpredictable QR token;
- SHA-256 token hash for lookup;
- provenance status;
- Founder’s Token type.

The physical QR resolves to:

`/pages/provenance?token=<unpredictable-token>`

Sequential object numbers are display identifiers only and are not authentication secrets.

The public Birth Record may show:

- product / edition / object number;
- record ID;
- Size;
- acquisition and record timestamps;
- lifecycle state;
- design and production origin;
- public Identity alias only when the collector opted in;
- Founder’s Token state according to reveal policy.

It must never expose email, shipping address, Shopify customer ID or other private collector data.

## Founder’s Token

Edition 01 is designed around 50 physical collector tokens:

- 49 silver-tone
- 1 gold-tone

Technical allocation rules:

- allocation runs only after the 50-object set is finalized;
- the operator cannot choose the gold recipient;
- the engine selects one object using cryptographically secure randomness with rejection sampling;
- allocation metadata is written once to the Edition row;
- concurrent allocation attempts fail closed;
- exactly one gold and 49 silver values are integrity-checked;
- the result is shown as `SEALED` in Collector Access and public provenance until the object reaches `delivered`;
- after delivery the actual token type becomes visible.

This technical mechanism is launch-gated by jurisdictional legal review. PHAM must not represent the finish variation as an investment, cash-value prize or guaranteed resale benefit.

## Archive gate

`sold_out → archived` is not a cosmetic state change.

The engine requires:

- all 50 reservations are `final_paid`;
- all 50 objects exist;
- all 50 acquired objects are `delivered`;
- Founder’s Token allocation is complete;
- exactly one gold and 49 silver tokens exist.

The transition writes an `archived` lifecycle event for each delivered object and then seals the edition state.

Brand rule:

**PHAM does not return to an edition once it is closed.**

The public Edition page remains the edition ledger rather than disappearing. It carries object count, acquired/delivered counters, origin and permanent archive status.

## Object Identity

Paid and referral-unlocked Identity privileges share the same 15-slot pool.

Identity configuration can include:

- alias;
- inscription;
- preferred object number;
- public/private provenance identity preference.

Object-number claims are locked server-side. A conflicting request returns `object_number_taken`; the collector must choose another number.

## Size authority

When the Edition Engine is enabled, `editions.size_options_csv` is the runtime source of truth.

For every configured size, readiness requires exactly one active Shopify final-product variant at the configured final price. Final and standby payments fail closed when the stored Size Preference cannot resolve to the exact mapped variant. Paid-order classification accepts the size-specific Edition 01 final SKU family rather than relying on one legacy base SKU.

## Digital lookbook

A confirmed Priority Reservation includes the configured edition-exclusive digital lookbook only when the real delivery path is ready.

The engine tracks:

- `pending`
- `entitled`
- `delivered`
- `failed`

The asset, version, customer-access path and any market-specific digital-content consent must be verified end-to-end before `DIGITAL LOOKBOOK READY` and `COMMERCE READY` are enabled.

## Core data model

### editions

Campaign state, commercial configuration, size set, origins, final-product configuration and immutable Founder’s Token allocation metadata.

### reservations

Shopify order/customer binding, reservation/final-payment state, Size Preference, final variant, object number, acquisition timestamp, current lifecycle stage and tracking data.

### identity_claims

One record per eligible reservation with source, configuration, engraving and public-identity preference.

### referrals

Verified referrer/referred reservation binding.

### standby

FIFO queue, Size Preference, mapped final variant, offer deadline and conversion link.

### objects

Permanent numbered object, reservation binding, authentication token hash, QR token, provenance status and Founder’s Token type.

### object_lifecycle_events

Append-only operational history for post-acquisition object state changes.

### webhook_events

Idempotency and review queue for paid-order and fulfillment webhook processing.

## Critical fail-closed rules

- Object-number claims are atomic and server-side.
- Reservation capacity is enforced in the write statement, not only by a prior count.
- A collector cannot hold two active reservations for the same edition.
- Paid/referral Identity claims share one capped pool.
- One referred reservation rewards at most one referrer.
- Standby is FIFO.
- Final and standby invoices use the exact Size-mapped active variant.
- Campaign payments validate status, quantity, price, discount, customer, currency, variant and active deadline.
- Fulfillment events cannot skip lifecycle stages.
- QR authentication uses unpredictable tokenized routes.
- Edition archive cannot occur before delivery of the complete object set.

## D1 migration policy

- `0001_initial.sql` remains the baseline migration.
- New lifecycle/token fields are introduced by `0002_object_lifecycle.sql`.
- `schema.sql` represents the complete current schema.
- `backend/check-schema.py` compares the reconstructed migration schema against `schema.sql`, including `object_lifecycle_events`.

Do not rewrite an already-applied migration to deploy new production columns. Add a forward migration instead.

## Launch boundary

Code readiness does not equal production readiness.

Before opening Priority Reservation, PHAM still requires real Shopify product/variant configuration, Cloudflare/D1 deployment, App Proxy, webhook permissions, digital lookbook delivery, shipping/tax/duty checks, physical Identity/QR/token production, final QC criteria, legal review and a real end-to-end staging purchase.
