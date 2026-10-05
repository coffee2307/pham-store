# PHAM Edition 01 Launch Runbook

This runbook is the operational sequence for opening PHAM-001 / Edition 01. It intentionally separates storefront presentation from backend state so the campaign cannot be opened by changing one theme setting alone.

## 0. Non-negotiable rule

Do not open Priority Reservation until all of the following are true:

- the Cloudflare Worker is deployed;
- D1 migrations are applied;
- Shopify ORDERS_PAID webhook is registered;
- Shopify App Proxy resolves /apps/pham-edition to the Worker;
- Digital Products has the real Edition 01 lookbook attached;
- the lookbook product is publishable and delivery has been tested end-to-end;
- PHAM-001 Priority Reservation is ready;
- PHAM Object Identity inventory is 15;
- PHAM-001 final product data is correct;
- Edition 01 terms have completed legal review;
- shipping, tax and duty behavior has been tested;
- staging verification passes.

Theme Settings alone must never be treated as the source of truth once ENGINE ENABLED is on.

## 1. Infrastructure deployment

Required GitHub secrets:

- CLOUDFLARE_API_TOKEN
- CLOUDFLARE_ACCOUNT_ID
- CLOUDFLARE_D1_DATABASE_ID
- SHOPIFY_SHOP_DOMAIN
- SHOPIFY_ADMIN_TOKEN
- SHOPIFY_API_SECRET
- INTERNAL_ADMIN_KEY
- CAMPAIGN_BACKEND_URL
- STOREFRONT_ORIGIN

Run:

GitHub Actions -> Deploy PHAM Campaign Worker -> Run workflow

The deployment workflow:

1. validates secrets;
2. injects the D1 database ID;
3. checks Worker syntax;
4. runs backend tests;
5. applies D1 migrations;
6. deploys the Worker;
7. uploads Worker secrets;
8. deploys the final Worker version;
9. registers ORDERS_PAID webhook.

## 2. Shopify App Proxy

Configure the app proxy so the storefront path:

/apps/pham-edition

forwards to the deployed Worker.

The theme expects these routes:

- /campaign
- /status
- /identity/configure
- /standby/join
- /provenance

Do not enable PHAM Campaign Engine in Theme Settings until the App Proxy route works.

## 3. Digital lookbook

The Digital Products product is:

PHAM Edition 01 Collector Lookbook

Before launch:

1. attach the final real lookbook file;
2. verify file name/version;
3. verify the product remains a genuine included digital benefit;
4. test purchase entitlement on a controlled test order;
5. verify the customer can access the file;
6. verify delivery copy and legal consent;
7. set DIGITAL LOOKBOOK READY only after successful test.

Digital Products does not currently expose download-state telemetry through the connected tooling used by this project. The campaign engine therefore treats successful reservation payment as entitlement creation and supports explicit operator reconciliation:

node admin.mjs mark-lookbook --reservation=PHAM-R-... --status=delivered

Allowed states:

- pending
- entitled
- delivered
- failed

## 4. Prelaunch staging verification

Keep:

- Campaign State: PRELAUNCH
- ENGINE ENABLED: OFF until App Proxy is configured
- COMMERCE READY: OFF
- DIGITAL LOOKBOOK READY: OFF until the real asset is tested

After backend deployment and App Proxy setup:

1. enable ENGINE ENABLED;
2. keep COMMERCE READY off;
3. run GitHub Actions -> Verify PHAM Campaign Staging.

The staging workflow verifies:

- Worker /health;
- internal readiness;
- App Proxy campaign route;
- campaign remains closed.

Do not proceed if the workflow fails.

## 5. Commerce readiness

Before COMMERCE READY is enabled, verify:

### Priority Reservation
- SKU: PHAM-001-RES-E01
- price: $24.99
- inventory: 50
- oversell: denied
- shipping: not required

### Object Identity
- SKU: PHAM-ID-E01
- price: $5.00
- inventory: 15
- oversell: denied
- shipping: not required at reservation checkout

### Final object
- product: PHAM-001
- configured final price: $199.00
- canonical size set for Edition 01: XS / S / M / L / XL
- exactly one active Shopify variant must exist for every configured Size option
- every configured size variant must be priced at $199.00
- the Edition Engine readiness check fails if a configured size is missing, duplicated or mispriced

### Lookbook
- price: $0.00
- included with Reservation
- real file attached
- digital entitlement tested

## 6. Open Priority Reservation

First enable in Theme Settings:

- ENGINE ENABLED = ON
- DIGITAL LOOKBOOK READY = ON
- COMMERCE READY = ON

Keep the D1 campaign state PRELAUNCH until the last step.

Synchronize the canonical size list in the Edition Engine before readiness:

node admin.mjs set-size-options --sizes=XS,S,M,L,XL --confirm --edition=edition-01

When ENGINE ENABLED is on, the Edition Engine size list is the runtime source of truth. The Theme Setting size list is only the storefront fallback before the live engine response is loaded.

Run backend readiness:

node admin.mjs readiness --edition=edition-01

Only if readiness passes, open the live campaign:

node admin.mjs set-state --state=reservation_open --confirm --edition=edition-01

Expected storefront behavior:

- Homepage CTA -> RESERVE PRIORITY ACCESS
- Reservation checkout enabled
- base total -> $24.99
- with Object Identity -> $29.99
- referral code persisted
- lookbook $0 item bundled
- live counters read from engine

## 7. Reservation order processing

When Shopify sends ORDERS_PAID for PHAM-001-RES-E01, the Worker fails closed before allocating a slot. It verifies:

1. webhook HMAC and Shopify shop;
2. webhook deduplication;
3. the order is fully paid;
4. the cart contains exactly one Reservation and one $0 Lookbook, plus at most one Identity add-on;
5. Reservation quantity = 1 and price = $24.99;
6. Identity, when present, quantity = 1 and price = $5.00;
7. Lookbook quantity = 1 and price = $0.00;
8. no unexpected campaign/non-campaign line item is mixed into the reservation order;
9. no discount altered the campaign price;
10. edition/product line properties match Edition 01 / PHAM-001;
11. Reservation terms and digital-lookbook consent evidence are present;
12. a non-empty Size Preference is present;
13. the collector does not already hold another active Edition 01 reservation;
14. reservation capacity remains available.

Only after those checks does the Worker create the PHAM reservation ID/referral code, persist size preference, resolve Identity/referral state, sync Shopify metafields and move the edition to reservation_full at 50 active reservations.

Validation discrepancies are stored as webhook review-required records instead of silently allocating inventory.

## 8. Referral reward

A referral counts only when:

- the referred reservation is paid;
- it is a different customer;
- it is a different email;
- the referred reservation has not already rewarded another collector.

If valid:

- verified referral count increments;
- referrer receives Object Identity if a slot remains;
- one Identity unit is removed from Shopify inventory;
- paid and referral rewards share the same 15-slot pool.

## 9. Reservation full / standby

At 50 active reservations the backend transitions to:

reservation_full

Expected storefront behavior:

- paid Reservation checkout closes;
- Standby opens;
- Standby is free;
- a Size Preference is required and stored with the queue entry;
- FIFO queue position is returned by the engine.

No customer in Standby receives a $24.99 credit. When the engine promotes a standby entry it resolves the exact active PHAM-001 Shopify variant whose Size option matches that queue entry before creating an invoice.

## 10. Open final acquisition

Before opening final acquisition, every reservation with a Size Preference must have a validated Shopify variant mapping:

node admin.mjs assign-variant --reservation=PHAM-R-... --variant=gid://shopify/ProductVariant/...

The mapping command rejects inactive products, the wrong $199 price, and a Size option that does not match the reservation.

When PHAM is ready to collect the remaining balances:

node admin.mjs open-final-payment --edition=edition-01

The command preflights all active reservations and fails before sending invoices if any required size mapping is missing. It is retry-safe after a partial Shopify failure and preserves an already-open payment deadline.

For every active reservation the engine creates a customer-bound Shopify Draft Order using that reservation's mapped variant:

PHAM-001: $199.00
Priority Reservation Credit: -$24.99
Remaining object balance: $174.01

The customer receives the Shopify invoice with a 72-hour deadline.

Collector Access displays:

- reservation state;
- live countdown;
- invoice link;
- remaining balance.

## 11. Expiry

Cron runs every 15 minutes.

If a reserved collector does not pay within the final-payment window:

1. the unpaid Draft Order is closed;
2. reservation becomes expired;
3. object-number hold is released;
4. Identity privilege is released;
5. Shopify Identity inventory is restored;
6. next Standby customer is promoted.

A paid Identity released because the reservation expired should be flagged for financial/policy review.

## 12. Standby promotion

The next FIFO Standby customer receives a Draft Order at full price:

$199.00

No reservation credit applies.

Default offer window:

48 hours

If the Standby offer expires:

- Draft Order is closed;
- queue entry becomes expired;
- next customer is promoted.

If paid, the Worker accepts the order only if the offer is still active, the exact size-mapped variant is present once, price is exactly $199, no discount was applied, currency matches, and the paying customer/email matches the standby entry.

After validation:

- a final_paid reservation record is created;
- Size Preference, final variant and final Shopify order are retained for audit;
- collector gets a reservation ID/referral code for archive consistency;
- no reservation lookbook entitlement is implied unless PHAM later changes this rule.

## 13. Object Identity configuration

An eligible collector can submit:

- identity alias;
- inscription up to 40 characters;
- preferred object number;
- public/private provenance identity choice.

The engine locks object numbers server-side.

If another collector already holds the requested number:

object_number_taken

The customer must choose another number.

## 14. Edition finalization

Do not finalize objects until:

- all 50 objects are final_paid;
- all active Identity claims are configured or revoked.

Run:

node admin.mjs finalize-objects --confirm --edition=edition-01

The engine then:

1. preserves chosen Identity numbers;
2. assigns remaining numbers to non-Identity collectors;
3. creates object records;
4. generates unpredictable QR tokens;
5. stores only token hashes for authentication lookup;
6. creates provenance URLs;
7. changes the edition to sold_out.

QR URL format:

https://phamofficial.com/pages/provenance?token=<unpredictable-token>

The public provenance page validates the token through App Proxy.

## 15. Founder’s Token

Founder’s Token allocation is intentionally not randomized by the purchase system.

Edition 01 target:

- 49 silver-tone
- 1 gold-tone

After objects are finalized, an authorized operator explicitly selects the gold object:

node admin.mjs allocate-tokens --gold=<object-number> --confirm --edition=edition-01

The system verifies exactly:

- 1 gold
- 49 silver

Do not market or automate the gold allocation as a purchase-linked random prize until the promotional mechanism has received jurisdictional legal review.

## 16. Archive

After Edition 01 is complete and archive material is ready:

node admin.mjs set-state --state=archived --confirm --edition=edition-01

Future editions reuse the same state machine and backend architecture with a new edition record and product configuration.

## Emergency controls

To close Reservation before the edition fills:

node admin.mjs set-state --state=prelaunch --confirm --edition=edition-01

This stops the engine from reporting reservation_open. The storefront uses the engine state and fails closed.

For any discrepancy involving money, Identity inventory, object number, referral attribution or final payment:

1. do not manually alter multiple systems independently;
2. preserve Shopify order data;
3. preserve D1 records;
4. stop the campaign if necessary;
5. reconcile through the operator workflow;
6. document the correction.
