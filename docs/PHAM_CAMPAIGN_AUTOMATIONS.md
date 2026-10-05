# PHAM Campaign Automation Contract

This document defines the reusable operational workflow for PHAM numbered editions. Edition 01 uses PHAM-001, but the same event model is intended for Edition 02, 03, 04 and later releases.

## Safety gates

A campaign has two independent controls:

- Campaign State: PRELAUNCH / RESERVATION OPEN / RESERVATION FULL / FINAL PAYMENT / SOLD OUT / ARCHIVED.
- COMMERCE READY: explicit boolean safety gate.

Changing Campaign State alone must never enable reservation checkout while COMMERCE READY is OFF.

For Edition 01, COMMERCE READY remains OFF until the full launch gate has passed.

## Commerce products prepared for Edition 01

### PHAM-001 Priority Reservation

- Price: $24.99
- SKU: PHAM-001-RES-E01
- Inventory: 50
- Inventory tracking: ON
- Overselling: DENY
- Shipping required: NO
- Status during preparation: DRAFT
- Credit against final PHAM-001 price: $24.99
- Final balance for reserved collector: $174.01

### PHAM Object Identity

- Price: $5.00
- SKU: PHAM-ID-E01
- Inventory: 15
- Inventory tracking: ON
- Overselling: DENY
- Shipping required at reservation checkout: NO
- Status during preparation: DRAFT
- Physical card ships with the final object, not with the reservation order.

The Shopify Identity product inventory is only one guard rail. Referral-unlocked Identity privileges must consume the same 15-slot pool through backend/automation logic.

## Reservation checkout payload

The theme gateway is prepared to add Priority Reservation and optional paid Object Identity.

The gateway records line-item properties for:
- PHAM Edition
- PHAM Product
- Referral Code
- Reservation terms acceptance
- Digital lookbook delivery request
- Identity source = Paid upgrade

The browser persists a valid referral code supplied as ?ref=CODE and carries it into reservation checkout.

Referral conversion is not verified until payment succeeds and anti-self-referral checks pass.

## Order metafield contract

Namespace: pham

- edition_label
- reservation_id
- referral_code
- identity_selected
- identity_source
- digital_lookbook_status
- final_payment_status
- payment_deadline

Line-item properties are acquisition-time evidence; automation should copy validated values into order/customer metafields.

## Customer metafield contract

Namespace: pham

- referral_code
- successful_referrals
- current_reservation_status
- current_object_number
- identity_status
- payment_deadline
- reservation_id
- identity_source

## Recommended reservation states

- pending_payment
- active
- final_payment_open
- final_paid
- expired
- cancelled
- standby_replaced
- fulfilled
- archived

## Recommended Identity states

- locked
- eligible_paid
- eligible_referral
- claimed
- configured
- production_locked
- fulfilled

## Email lifecycle

### 1. Reservation paid

Trigger: reservation payment confirmed.

Subject direction: OBJECT RESERVED — WELCOME TO {{ edition }}

Include reservation ID, edition/product, amount paid, remaining balance, payment-window rule, Collector Access link, referral link, Identity status and digital lookbook access.

Digital lookbook status should transition: pending -> sent -> delivered where delivery tooling can verify it.

### 2. Digital lookbook delivery

Trigger: reservation payment confirmed and digital product entitlement generated.

Subject direction: YOUR {{ edition }} COLLECTOR LOOKBOOK

Store asset/version identifier, sent timestamp, recipient and provider delivery/download evidence when available.

Do not represent delivery as eliminating mandatory statutory rights.

### 3. Referral progress

Trigger: collector receives referral code.

Subject direction: UNLOCK OBJECT IDENTITY

Explain that one verified paid referral is required, clicks/signups do not count, self-referrals do not count, and the Identity pool is shared and limited.

### 4. Identity unlocked

Trigger: one valid referral is verified while an Identity slot remains.

Actions:
- consume one shared Identity slot atomically
- set identity_source = referral
- set identity_status = claimed
- send configurator link

### 5. Identity configured

Trigger: collector submits valid card configuration.

Store alias/name, inscription, preferred object number, public identity opt-in and configuration version/timestamp.

Preferred object numbers are not guaranteed until server-side lock succeeds.

### 6. Final payment opened

Trigger: PHAM opens acquisition window.

Edition 01 values:
- Object price: $199.00
- Reservation credit: $24.99
- Balance: $174.01
- Window: 72 hours

Subject direction: YOUR PHAM-001 ACQUISITION WINDOW IS OPEN

Create/send a customer-specific payment link or Draft Order.

Set final_payment_status = open and payment_deadline = opened_at + 72h.

### 7. Payment reminder

Recommended sends: T-24h and T-3h.

### 8. Reservation expired

Trigger: deadline passes without successful final payment.

Actions:
- final_payment_status = expired
- current_reservation_status = expired
- release object allocation
- apply the published refund/cancellation policy subject to mandatory law
- promote first eligible standby record

### 9. Standby promoted

Edition 01 standby price: full $199.00.

Recommended offer window: 48 hours.

Subject direction: A PHAM-001 OBJECT HAS BECOME AVAILABLE

The standby customer receives no $24.99 credit because no reservation amount was previously paid.

### 10. Object confirmed

Trigger: final balance paid.

Subject direction: OBJECT CONFIRMED

Set final_payment_status = paid, current_reservation_status = final_paid, lock object assignment, and prepare provenance.

## Referral verification rules

A successful referral requires:
- referred reservation payment succeeded
- referred order/customer differs from referrer
- referred reservation has not already rewarded another referrer
- referral is not flagged for abuse/fraud
- Identity slot exists when reward is claimed

For Edition 01 manual review is acceptable because only 50 reservations exist, but the backend still needs atomic slot consumption.

## Standby rules

- Joining standby is free.
- Queue order defaults to FIFO.
- Standby begins only after paid reservation allocation is closed.
- A promoted standby customer pays full price.
- Default offer window: 48 hours.
- Expired standby offer moves to the next eligible entry.

## Digital Products dependency

The store currently does not have Shopify Digital Products installed.

Until installed, lookbook delivery cannot be wired through the Digital Products connector.

Do not turn COMMERCE READY on until one real delivery path has been tested end-to-end.

## Launch test cases

1. Reservation only = $24.99.
2. Reservation + Identity = $29.99.
3. Identity unavailable at 15/15.
4. Referral code persists into checkout.
5. One customer cannot create a valid self-referral reward.
6. Reservation inventory stops at zero.
7. 50th successful reservation closes paid allocation operationally.
8. Standby form accepts free signup only.
9. Lookbook email arrives and asset opens.
10. Final payment request is exactly $174.01.
11. 72-hour expiry changes status correctly.
12. Expired slot promotes standby customer.
13. Standby customer is charged full $199.
14. Object number cannot be claimed by two collectors.
15. QR/provenance record does not expose private customer data.
