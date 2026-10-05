# PHAM Edition Release System

## Objective

PHAM uses one reusable release architecture for numbered editions. Edition 01 begins with PHAM-001, but Edition 02, 03, 04 and later releases should reuse the same state machine and UI rather than duplicate campaign code.

## Campaign states

1. PRELAUNCH
2. PRIORITY RESERVATION OPEN
3. RESERVATION FULL / STANDBY OPEN
4. FINAL PAYMENT WINDOW
5. SOLD OUT
6. ARCHIVED

The active state is controlled under Theme Settings → PHAM · Current Edition during Phase A.

## Edition 01 MVP defaults

- Edition size: 50
- Priority Reservation: $24.99
- Final product price: $199.00
- Reserved-customer balance: $174.01
- Object Identity upgrade: $5.00
- Identity privilege cap: 15 total
- Identity unlock: paid upgrade OR one verified successful reservation referral
- Final-payment window: 72 hours
- Standby: free
- Standby promoted price: full $199.00
- Planned standby offer window: 48 hours
- Canonical size set: XS / S / M / L / XL
- Final payment: exact Shopify variant must match the collector's stored Size Preference

All values remain configurable for future editions.

## Digital lookbook

A confirmed Priority Reservation is planned to include an edition-exclusive digital lookbook delivered after payment confirmation.

This must remain a genuine digital deliverable, not a device to evade refund obligations. Before launch:

- attach the real files or secure download package;
- record the exact version delivered;
- obtain any consent required for immediate digital-content delivery in the customer’s market;
- log delivery timestamp and recipient;
- retain download/delivery evidence where supported;
- state clearly what the reservation purchases and how the $24.99 credit works;
- preserve the qualifier that statutory consumer rights apply where mandatory.

Do not claim that sending a digital file automatically eliminates all cancellation or refund rights worldwide.

## Phase A implemented in the theme

Templates:

- page.edition
- page.reservation
- page.identity-card
- page.referral
- page.reservation-status
- page.standby
- page.provenance
- page.edition-terms

Sections:

- PHAM Edition Campaign
- PHAM Reservation
- PHAM Identity Card
- PHAM Referral Hub
- PHAM Collector Status
- PHAM Standby
- PHAM Provenance
- PHAM Edition Terms

Phase A performs no transactional backend writes. The Identity Card configurator is a UI prototype only.

## Phase B — Shopify commerce wiring

Create or configure:

1. Priority Reservation product with controlled inventory.
2. Object Identity add-on or equivalent fulfillment model.
3. Customer and order tags/metafields.
4. Checkout consent and order/line properties.
5. Reservation confirmation email.
6. Digital lookbook delivery automation.
7. Collector account activation.
8. Campaign counters sourced from real order data.

Suggested lifecycle events:

- reservation.paid
- reservation.cancelled
- reservation.expired
- identity.claimed.paid
- referral.verified
- identity.claimed.referral
- final_payment.opened
- final_payment.paid
- standby.joined
- standby.promoted
- object.assigned
- object.shipped

## Phase C — transactional backend

Core entities:

### Edition
- id
- label
- product_code
- edition_size
- state
- reservation_price
- final_price
- identity_limit

### Reservation
- id
- edition_id
- shopify_customer_id
- shopify_order_id
- status
- reservation_paid
- balance_due
- size_preference
- final_variant_id
- payment_deadline
- final_shopify_order_id
- object_id
- created_at

### Identity privilege
- reservation_id
- source: paid | referral
- status
- preferred_number
- engraving_name
- engraving_text
- public_identity

### Referral
- code
- referrer_reservation_id
- referred_reservation_id
- status
- verified_at

### Standby
- edition_id
- customer_id
- email
- country
- size_preference
- final_variant_id
- position
- status
- promoted_at
- offer_deadline

### Object
- edition_id
- number
- reservation_id
- auth_token_hash
- provenance_status
- token_type

## Critical rules

- Object-number claims must be atomic and server-side.
- Paid and referral unlocks share the same 15-slot Identity pool.
- A referral counts only after a different customer successfully pays for a valid reservation.
- One referred reservation can reward one referrer only.
- Standby is FIFO unless a future edition publishes another rule.
- A promoted standby customer receives no reservation credit and pays full price.
- Size options published by the live Edition Engine are the runtime source of truth when ENGINE ENABLED is on.
- A final or standby invoice must use the exact Shopify variant mapped to the stored Size Preference; missing or ambiguous mappings fail closed.
- Campaign payment webhooks must validate quantities, expected prices, discounts, customer binding and active deadlines before changing reservation state.
- QR authentication must use an unpredictable signed/tokenized route; sequential URLs alone are not proof of authenticity.

## Theme-read customer metafields

The MVP UI is ready to read:

- pham.referral_code
- pham.successful_referrals
- pham.current_reservation_status
- pham.current_object_number
- pham.identity_status
- pham.size_preference
- pham.payment_deadline

## Provenance page metafields

The MVP provenance template reads:

- pham.object_number
- pham.product_code
- pham.edition_label
- pham.auth_status
- pham.public_identity
- pham.identity_label
- pham.design_record
- pham.production_record
- pham.qc_record

A later metaobject/backend migration can replace page-based records without changing the visual system.

## Founder’s Token

Edition 01 currently plans 50 collector tokens: 49 silver-tone and one gold-tone. Do not hard-wire a purchase-linked chance mechanic into checkout until promotional-prize rules have been reviewed for the markets where PHAM sells.

## Launch gate

Do not move the campaign from PRELAUNCH until these are ready:

- final product and reservation inventory;
- final photography and lookbook files;
- Identity Card manufacturing constraints;
- final 15-slot allocation behavior;
- live reservation product;
- transactional email delivery;
- legal review of reservation and digital-content terms;
- taxes, duties and shipping configuration;
- 72-hour expiry automation;
- standby promotion automation;
- refund/cancellation operational playbook;
- object-number locking;
- provenance authentication endpoint.
