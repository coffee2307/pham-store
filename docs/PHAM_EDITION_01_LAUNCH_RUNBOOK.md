# PHAM Edition 01 Launch Runbook

This is the operational sequence for PHAM-001 / Edition 01. It separates brand presentation, Shopify commerce, Edition Engine state and physical fulfillment so no single toggle can accidentally open the edition.

## 0. Launch rule

Do not open Priority Reservation until all launch gates are green.

Required before launch:

- Cloudflare Worker deployed from the intended commit;
- D1 schema verified and all forward migrations applied;
- Shopify App Proxy working;
- `ORDERS_PAID`, `FULFILLMENTS_CREATE` and `FULFILLMENTS_UPDATE` subscriptions registered;
- Shopify app/token has the scopes required for order, product/inventory and fulfillment access used by the system;
- Priority Reservation, Identity, lookbook and final PHAM-001 product configuration verified;
- all configured PHAM-001 Size variants exist exactly once at $199.00;
- real Edition 01 lookbook attached and tested;
- shipping, tax and duty behavior tested;
- Identity card, QR and Founder’s Token production constraints finalized;
- campaign-specific legal review complete, including reservation/digital-content terms and Founder’s Token mechanism;
- real staging purchase and post-purchase flow passes.

Theme Settings are not the live authority when the Edition Engine is enabled.

## 1. D1 schema and migration audit

Current repository migration chain:

- `0001_initial.sql` — baseline
- `0002_object_lifecycle.sql` — acquisition timestamp, physical object lifecycle, tracking fields, lifecycle event table and Founder’s Token allocation metadata

Before deployment, confirm what the remote D1 database has already applied.

Use GitHub Actions → **Audit PHAM Campaign Production** for a read-only migration/schema snapshot. This workflow requires the three Cloudflare GitHub secrets before it can run.

Important: older repository work historically folded some schema changes into `0001_initial.sql`. If the remote D1 had already applied an earlier copy of 0001, verify that it contains every current column/index before launch. Do not assume that editing the repository copy of 0001 retroactively changes a remote database.

CI command:

`python backend/check-schema.py`

The check reconstructs the schema from migrations and compares it with `backend/schema.sql`.

## 2. Required deployment secrets

GitHub Actions requires:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_D1_DATABASE_ID`
- `SHOPIFY_SHOP_DOMAIN`
- `SHOPIFY_ADMIN_TOKEN`
- `SHOPIFY_API_SECRET`
- `INTERNAL_ADMIN_KEY`
- `CAMPAIGN_BACKEND_URL`
- `STOREFRONT_ORIGIN`

The workflow must read `SHOPIFY_SHOP_DOMAIN` from the secret. Do not hard-code a myshopify domain into deployment configuration.

Run:

GitHub Actions → **Deploy PHAM Campaign Worker** → Run workflow

The workflow:

1. validates deployment secrets;
2. injects the D1 database ID;
3. validates backend syntax/tests;
4. applies D1 migrations;
5. deploys the Worker;
6. uploads Worker secrets;
7. deploys the final Worker version;
8. registers paid-order and fulfillment webhooks.

On a first deployment without `CAMPAIGN_BACKEND_URL`, copy the deployed Worker URL into that secret and rerun the workflow so webhook subscriptions can be created.

## 3. Shopify App Proxy

The storefront path:

`/apps/pham-edition`

must forward to the deployed Worker.

Public/collector proxy routes:

- `GET /campaign`
- `GET /status`
- `POST /identity/configure`
- `POST /standby/join`
- `GET /provenance`

Do not enable the Edition Engine in the theme until these routes resolve through the Shopify App Proxy.

## 4. Shopify webhook contract

The registration script creates:

- `ORDERS_PAID → /webhooks/orders-paid`
- `FULFILLMENTS_CREATE → /webhooks/fulfillments`
- `FULFILLMENTS_UPDATE → /webhooks/fulfillments`

Every webhook is HMAC verified, shop-domain verified and deduplicated using Shopify’s webhook delivery ID.

Fulfillment automation is intentionally conservative:

- tracking on a `packed` PHAM object advances it to `dispatched`;
- a delivered shipment advances only `dispatched → delivered`;
- a fulfillment event that would skip required stages is placed in the review queue;
- non-PHAM fulfillments are ignored.

## 5. Shopify commerce configuration

### Priority Reservation

- SKU: `PHAM-001-RES-E01`
- Price: $24.99
- Inventory: 50
- Inventory tracking: ON
- Oversell: DENY
- Physical shipping at reservation checkout: NO

### Object Identity

- SKU: `PHAM-ID-E01`
- Price: $5.00
- Shared privilege inventory: 15
- Oversell: DENY
- Physical shipping at reservation checkout: NO

The physical steel Identity card ships later with the final object.

### Final PHAM-001

- Price: $199.00
- Canonical Size set: M / L / XL / XXL
- SKU convention:
  - M → `PHAM-001-E01-M`
  - L → `PHAM-001-E01-L`
  - XL → `PHAM-001-E01-XL`
  - XXL → `PHAM-001-E01-XXL`
- exactly one active variant for every configured Size
- every configured variant priced exactly at $199.00
- prelaunch final-object inventory may remain zero; do not expose sellable inventory until the acquisition inventory plan is reconciled against actual reservation Size Preferences
- PHAM-001 Size Guide page: `/pages/pham-001-size-guide`
- before enabling Fit Assistant, enter verified production measurements for M / L / XL / XXL: flat chest width, shoulder, sleeve and body length; do not use generic reference measurements

Readiness fails closed on missing, duplicate or mispriced Size variants.

### Digital lookbook

- Included with Priority Reservation as the configured $0 digital item
- real asset attached
- correct version confirmed
- entitlement tested
- customer can actually open/download it
- delivery/consent copy approved

## 6. Staging setup

Keep storefront gates closed while wiring production services:

- Campaign state: `prelaunch`
- ENGINE ENABLED: OFF until App Proxy works
- COMMERCE READY: OFF
- DIGITAL LOOKBOOK READY: OFF until asset test passes

After Worker/App Proxy setup:

1. enable ENGINE ENABLED;
2. leave COMMERCE READY off;
3. run **Verify PHAM Campaign Staging**.

The workflow checks:

- Worker health;
- backend readiness;
- App Proxy campaign route;
- canonical Size options;
- campaign remains closed.

## 7. Canonical Size setup

Set the runtime Size list:

`node admin.mjs set-size-options --sizes=M,L,XL,XXL --confirm --edition=edition-01`

Then run:

`node admin.mjs readiness --edition=edition-01`

When ENGINE ENABLED is on, this D1 Size list is authoritative. Theme Settings remain fallback presentation only.

## 8. Open Priority Reservation

Only after readiness passes:

1. ENGINE ENABLED = ON
2. DIGITAL LOOKBOOK READY = ON
3. COMMERCE READY = ON
4. leave D1 `prelaunch` until the last step
5. run:

`node admin.mjs set-state --state=reservation_open --confirm --edition=edition-01`

Expected storefront:

- reservation CTA live;
- reservation-only total $24.99;
- reservation + Identity total $29.99;
- Size Preference required;
- lookbook included;
- referral code carried into checkout;
- live counters from the Edition Engine.

## 9. Reservation payment processing

For a paid reservation, the Worker validates before allocating:

- webhook authenticity and idempotency;
- order status is exactly paid;
- exact Reservation / Lookbook / optional Identity bundle;
- quantities;
- $24.99 Reservation, $5 Identity and $0 Lookbook prices;
- no unexpected line item;
- no discount changing campaign economics;
- edition/product properties;
- terms and digital-content consent evidence;
- valid Size Preference;
- one active reservation per collector/email;
- atomic edition capacity.

Validation failures are written as `review_required` instead of silently creating campaign state.

Review queue:

`node admin.mjs reviews --limit=50`

## 10. Referral and Identity

A referral is verified only when:

- a different collector successfully pays for a valid Priority Reservation;
- email/customer does not match the referrer;
- that referred reservation has not rewarded someone else.

If the shared pool still has capacity, one verified referral unlocks Object Identity.

Paid and referral unlocks consume the same 15-slot backend pool.

Object Identity configuration supports:

- alias;
- inscription up to 40 characters;
- preferred object number;
- public/private Birth Record Identity preference.

Object numbers are locked server-side. Conflicts return `object_number_taken`.

## 11. Reservation full and standby

At 50 active reservations:

`reservation_full`

Behavior:

- paid Priority Reservation closes;
- free Standby opens;
- Size Preference is required;
- queue order is FIFO;
- duplicate active standby entry is prevented.

A promoted Standby customer receives a full-price $199 Draft Order and no $24.99 reservation credit.

Default offer window: 48 hours.

## 12. Final acquisition

Before opening the acquisition window:

`node admin.mjs map-variants --confirm --edition=edition-01`

The bulk operation preflights the entire edition and writes nothing if any Size mapping is missing, ambiguous or mispriced.

One-off repair:

`node admin.mjs assign-variant --reservation=PHAM-R-... --variant=gid://shopify/ProductVariant/...`

Review fail-closed events, then open:

`node admin.mjs open-final-payment --edition=edition-01`

Reserved collector Draft Order:

- PHAM-001: $199.00
- Priority Reservation credit: -$24.99
- Balance: $174.01
- Window: 72 hours

A successful final payment stores the final Shopify order, acquisition timestamp and automatically starts the object at `production_queued`.

Collector Access then changes from payment-oriented status to the private object record.

## 13. Expiry and standby replacement

Cron checks expiration every 15 minutes.

If the 72-hour final-payment window expires:

- unpaid Draft Order closes;
- reservation becomes expired;
- held object number is released;
- Identity privilege is released;
- referral-unlocked Identity inventory is reconciled;
- next eligible Standby record is promoted.

If a paid Identity add-on becomes detached from an expired reservation, treat it as a financial/policy review case.

## 14. Production lifecycle

After acquisition, use the operator workflow until production systems provide their own integration.

Advance one stage at a time:

`node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=in_production --confirm`

`node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=quality_control --confirm`

`node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=packed --confirm`

Do not mark `packed` until the final object, Identity materials, Founder’s Token package and QR/Birth Record insert required for that collector are physically reconciled.

Every change creates an append-only lifecycle event.

## 15. Dispatch and delivery

Preferred path: create/update the Shopify fulfillment with real tracking information.

When Shopify sends fulfillment tracking for an object currently at `packed`, the Worker records carrier/tracking and moves it to:

`dispatched`

When Shopify later reports shipment status `delivered`, the Worker moves:

`dispatched → delivered`

Manual recovery path:

`node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=dispatched --carrier=DHL --tracking=... --tracking-url=... --confirm`

`node admin.mjs set-lifecycle --reservation=PHAM-R-... --stage=delivered --confirm`

Dispatch cannot be recorded without a tracking number or URL.

## 16. Edition finalization and Birth Records

Do not finalize the object set until:

- all 50 objects are `final_paid`;
- active Identity claims are configured or revoked.

Run:

`node admin.mjs finalize-objects --confirm --edition=edition-01`

The engine:

1. preserves valid requested object numbers;
2. assigns remaining numbers deterministically to remaining acquired collectors;
3. creates 50 object records;
4. generates unpredictable QR tokens;
5. stores token hashes for authentication lookup;
6. creates permanent tokenized Birth Record URLs;
7. moves the edition to `sold_out`.

QR format:

`https://phamofficial.com/pages/provenance?token=<unpredictable-token>`

The public Birth Record does not expose private collector contact/account data.

## 17. Founder’s Token

Technical Edition 01 target:

- 49 silver-tone
- 1 gold-tone

The operator no longer chooses the gold recipient.

After final object creation, and only after the Founder’s Token mechanism has passed final legal review, run:

`node admin.mjs allocate-tokens --confirm --edition=edition-01`

The Edition Engine:

- performs one cryptographically secure random allocation;
- stores the allocation metadata once;
- rejects repeated/concurrent allocation attempts;
- verifies exactly 1 gold and 49 silver;
- exposes only `SEALED` to the collector/public Birth Record until that object reaches `delivered`.

Do not describe the gold-tone finish as an investment, cash-value prize or guaranteed resale benefit.

## 18. Digital lookbook reconciliation

Backend status values:

- `pending`
- `entitled`
- `delivered`
- `failed`

When delivery tooling cannot update the engine directly:

`node admin.mjs mark-lookbook --reservation=PHAM-R-... --status=delivered`

Retain delivery evidence and asset version in the actual digital-product system where available.

## 19. Archive

Archive is permitted only when the engine verifies:

- 50 final-paid reservations;
- 50 object records;
- 50 delivered objects;
- 1 gold Founder’s Token;
- 49 silver Founder’s Tokens.

Then:

`node admin.mjs set-state --state=archived --confirm --edition=edition-01`

The engine writes archived lifecycle events and permanently changes the edition state.

The Edition page becomes the public edition ledger; it should remain accessible as part of PHAM’s archive.

**PHAM does not return to an edition once it is closed.**

## 20. Emergency controls

Close Priority Reservation before capacity:

`node admin.mjs set-state --state=prelaunch --confirm --edition=edition-01`

For money, Identity inventory, object-number, referral, Size mapping, fulfillment or lifecycle discrepancies:

1. stop the relevant campaign action if necessary;
2. preserve Shopify order/fulfillment data;
3. preserve D1 records and webhook review entries;
4. do not manually edit multiple systems independently;
5. reconcile through the operator workflow;
6. document the correction.

## 21. Final staging acceptance

Before live opening, execute at least:

- Reservation-only purchase ($24.99);
- Reservation + Identity purchase ($29.99);
- lookbook entitlement and real access;
- referral conversion;
- Size mapping;
- final $174.01 reserved-collector invoice;
- full $199 standby invoice;
- final payment validation;
- object lifecycle through Production → QC → Packed;
- Shopify fulfillment → Dispatch;
- Shopify fulfillment update → Delivered;
- Birth Record token authentication;
- Founder’s Token allocation in a non-production test dataset if legal review is still pending;
- archive gate rejection while any object is undelivered.

Only after all checks pass should live Priority Reservation open.
