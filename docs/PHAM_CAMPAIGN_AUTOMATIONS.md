# PHAM Campaign Automation Contract

This document defines the reusable automation contract for PHAM numbered editions. Edition 01 uses PHAM-001; later editions should change edition/product configuration rather than duplicate the workflow.

## Control plane

A live edition has independent safety controls:

- D1 campaign state;
- Theme `COMMERCE READY`;
- live backend readiness;
- Shopify product/inventory state;
- digital-delivery readiness.

No single presentation toggle is allowed to open commerce when the backend cannot verify the edition.

## Reservation checkout contract

Edition 01 reservation bundle:

- Priority Reservation — $24.99
- Collector Lookbook — $0
- optional Object Identity — $5.00

Required reservation evidence includes:

- PHAM Edition;
- PHAM Product;
- referral code when present;
- Size Preference;
- reservation-terms acceptance;
- digital-lookbook delivery request;
- Identity source when selected.

A valid referral query code may be persisted by the storefront, but referral credit is not verified until the referred reservation itself passes paid-order validation.

## Paid-order automation

`ORDERS_PAID` is the authority for money-driven campaign changes.

Priority Reservation validation covers:

- webhook HMAC/shop/idempotency;
- financial status exactly `paid`;
- exact bundle and quantities;
- exact configured prices;
- no price-changing discount;
- no unexpected line item;
- edition/product metadata;
- consent evidence;
- Size Preference;
- duplicate collector prevention;
- atomic capacity.

Final reserved acquisition additionally validates:

- active 72-hour window;
- correct customer;
- correct currency;
- exact mapped Size variant;
- $199 line price;
- exactly $24.99 reservation credit.

Standby acquisition validates:

- promoted/active 48-hour offer;
- exact Size variant;
- $199 price;
- zero reservation credit/discount;
- paying collector/email binding.

A discrepancy produces a `review_required` webhook record instead of silently mutating campaign state.

## Reservation and collector metafields

Namespace: `pham`.

Important order/customer fields include:

- `edition_label`
- `reservation_id`
- `referral_code`
- `successful_referrals`
- `size_preference`
- `identity_selected`
- `identity_source`
- `identity_status`
- `digital_lookbook_status`
- `final_payment_status`
- `payment_deadline`
- `current_reservation_status`
- `current_object_number`
- `acquired_at`
- `object_lifecycle_stage`
- `tracking_number`

D1 remains authoritative; metafields support storefront fallback and operational visibility.

## Identity automation

Paid and referral-unlocked Identity privileges share one capped pool.

A successful referral requires:

- referred reservation paid and valid;
- referrer and referred reservation are different;
- customer/email anti-self-referral checks pass;
- referred reservation has not already rewarded another referrer;
- Identity capacity remains.

Object-number configuration is server locked. A number collision fails with `object_number_taken`.

## Standby automation

- Standby opens only after reservation allocation is full.
- Join is free.
- Size Preference is mandatory.
- Queue order is FIFO.
- Active duplicate queue entries are prevented.
- Promotion resolves the exact active Size-matching final variant.
- Promoted collector pays full final price.
- Expired offer advances the queue.

## Final acquisition → object lifecycle

A successfully validated final acquisition sets:

- reservation status = `final_paid`;
- final payment status = `paid`;
- acquisition timestamp;
- lifecycle = `production_queued`.

Physical lifecycle then progresses:

`production_queued → in_production → quality_control → packed → dispatched → delivered`

Each stage is append-only in `object_lifecycle_events`.

The transition validator rejects skipped or reversed states.

## Shopify fulfillment automation

Subscriptions:

- `FULFILLMENTS_CREATE`
- `FULFILLMENTS_UPDATE`

Automation mapping:

- current `packed` + real tracking → `dispatched`;
- current `dispatched` + Shopify `shipment_status=delivered` → `delivered`;
- tracking changes while dispatched/delivered update tracking metadata;
- fulfillment on an earlier production stage → review queue;
- fulfillment for a non-PHAM final order → ignored.

This design lets Shopify/carrier state automate shipment records without allowing fulfillment events to rewrite PHAM’s production/QC process.

## Collector Access contract

After reservation, Collector Access is the authenticated collector control surface.

Before final payment it exposes payment/referral/Identity actions.

After final payment it becomes the private object record and exposes:

- numbered object;
- acquisition timestamp;
- Size;
- Identity;
- production/delivery lifecycle;
- Birth Record;
- tracking;
- lookbook status;
- Founder’s Token reveal state.

## Birth Record contract

After finalization, every object receives an unpredictable provenance token.

Public Birth Record fields are intentionally non-sensitive. Authentication is based on the tokenized URL, not sequential object number.

The physical steel Identity/QR artifact should resolve to the same permanent Birth Record URL used by Collector Access.

## Founder’s Token allocation

Edition 01 technical rule:

- 50 object records required;
- 49 silver-tone;
- 1 gold-tone;
- allocation executed once after object finalization;
- operator cannot choose recipient;
- secure random index;
- race-safe immutable allocation metadata;
- exactly 1/49 integrity check;
- token type is `SEALED` in collector/public UI until physical delivery;
- actual finish revealed after `delivered`.

This automation remains subject to final jurisdictional legal approval before production use.

## Archive automation

Edition state can change `sold_out → archived` only when:

- all edition objects are final-paid;
- complete object set exists;
- every object is delivered;
- Founder’s Token distribution is complete and valid.

Archival writes the final object lifecycle event and makes the public Edition page the permanent ledger.

## Digital lookbook automation

Reservation payment creates the entitlement state. Actual delivery readiness cannot be inferred from a theme setting.

Operational states:

- `pending`
- `entitled`
- `delivered`
- `failed`

The production system must retain the real asset/version and delivery evidence where supported.

## Email / notification directions

Transactional messaging should map to actual state changes rather than generic marketing timing:

1. Reservation confirmed
2. Collector lookbook available
3. Identity unlocked/configured
4. Acquisition window opened
5. Payment reminder(s)
6. Acquisition confirmed
7. Production started
8. Quality control complete / object packed
9. Dispatch with tracking
10. Delivery / Birth Record + Founder’s Token reveal

Exact send infrastructure remains separate from the Edition Engine unless explicitly connected.

## Review queue

Use:

`node admin.mjs reviews --limit=50`

Review cases include money/variant/customer mismatches, duplicate collector races, capacity races and out-of-sequence fulfillment events.

Operators should reconcile the source record first rather than independently editing Shopify and D1.

## Minimum automated test matrix

1. Reservation-only = $24.99.
2. Reservation + Identity = $29.99.
3. Identity closes at shared capacity.
4. Referral anti-self checks.
5. Atomic reservation capacity at object 50.
6. Standby FIFO contention.
7. Every configured Size maps to one active $199 variant.
8. Wrong Size/price/discount/customer/deadline final payment fails closed.
9. Final payment enters `production_queued`.
10. Lifecycle cannot skip Production → QC → Packed.
11. Tracking on `packed` derives `dispatched`.
12. Fulfillment before `packed` requires review.
13. Delivered event only advances from `dispatched`.
14. Founder’s Token remains sealed before delivery.
15. Provenance exposes no private collector fields.
16. Archive rejects any edition with an undelivered object.
