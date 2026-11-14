# PHAM Edition 01 — launch control, collector experience, 50-object production board

**13 November 2026 · DEVELOPMENT / PRELAUNCH.** This file describes implemented code. None of these controls represents authorization to accept payment without production deployment and legal/merchant approval.

## Implemented

1. **Independent money-intake gate:** D1 migration `0006_paid_reservation_gate.sql` adds `editions.commerce_acceptance_enabled`, default **0** even if an old state erroneously says `reservation_open`. Both the storefront's purchase CTA and the Worker payment webhook require `state='reservation_open'` AND this flag equals 1. `setCampaignState` changes the two values together using the previous-state condition.
2. **Bypass handling:** A Shopify paid deposit received while the gate is closed receives `paid_reservation_outside_launch` and a `review_required` webhook record. **Important:** this prevents automatic collector allocation, not an earlier Shopify charge. The merchant must promptly investigate and apply the required refund or other remedy. The deposit SKU must be truly unavailable for direct purchase until launch; merely hiding a theme button is insufficient.
3. **Private 50-object ledger:** `GET /internal/operations?edition=edition-01` requires `INTERNAL_ADMIN_KEY`, omits customer emails and shipping addresses, and returns each numbered slot, reservation, size, payment state, stage, tracking and card confirmation state. Empty slots are **UNASSIGNED**, not advertised as available to buy.
4. **Production alerts:** counts for payment pending, incomplete sizes, pending object-number assignment, unverified Identity requests, not shipped and missing tracking. Duplicate reservation IDs/numbers and edition overcapacity fail closed.
5. **Private visual control board:** `node backend/operator-console.mjs --output=<private-directory>/PHAM-Edition-01-Board.html` reads the authorized Worker state, runtime readiness and ledger and generates a **read-only HTML report**. The file contains collector engraving data and must stay on an authorized device, outside the Git repository. The report does not embed secrets or make network calls when viewed.
6. **Collector Dashboard:** Live lookup must be verified before displaying order details. Otherwise, the record stays hidden and a clear support/error notice appears. Correctly differentiates awaiting invoice, active balance and paid balance; shows recorded lifecycle events and only accepts HTTPS invoice/tracking/provenance links.
7. **Manual Identity control:** names, inscriptions and notes are accepted only through actual customer messages over email or the PHAM-configured official WhatsApp number, then operator-verified before saving. Never infer a verified message from a clicked prefilled link.

## Operator commands

Run in the repository on a trusted computer with `CAMPAIGN_BACKEND_URL=https://<worker-host>` and `INTERNAL_ADMIN_KEY=<private-secret>`. Do not paste these keys into the theme, commit history, or HTML report.

```bash
node backend/admin.mjs health
node backend/admin.mjs state
node backend/admin.mjs readiness
node backend/admin.mjs operations
node backend/admin.mjs reviews
node backend/operator-console.mjs --output=F:/private/PHAM-Edition-01-Board.html
node backend/export-card-manifest.mjs --output=F:/private/PHAM-E01-Engraving.csv
```

Both file exports are private: save outside repository and do not share publicly. No live Worker connection is included in this repository, so these commands cannot show actual orders without the authenticated operational environment.

## Open-launch procedure — do not bypass any step

1. Resolve who is legally authorized to operate Shopify and the applicable ecommerce and data/privacy obligations for each destination.
2. Approve sample, actual 50-jacket production capacity, shipping estimates, return logistics, engraving constraints, packing list and customer-service capacity.
3. Reconcile the *live* theme flags vs the D1 edition state. Legacy backend may say `reservation_open` while Shopify theme is `prelaunch`: do not interpret that as permission to sell.
4. Eliminate direct public purchase of the $24.99 deposit SKU during prelaunch. Shopify may accept and capture payments before backend allocation; the Worker gate alone cannot stop checkout.
5. Apply D1 migrations `0004`, `0005`, and `0006` after examining remote migration history; deploy updated Worker. Verify paid order webhooks are handled only when D1 gate is open.
6. Confirm App Proxy and Shopify webhook signatures, idempotency, error review queue, rollback and refund procedures. Test deposit with $0 Lookbook, optional Identity, final $174.01 Draft Order, timeouts and standby.
7. Supply real digital Lookbook and verify delivery. Confirm payment provider, supported markets, shipping, tax and currency checks.
8. After the Merchant signs off the actual legal/commercial conditions, stage the Shopify theme and environment secrets, and use **PHAM Edition 01 — Release Gate** GitHub workflow `preflight`; only launch after green checks. Successful code CI alone never approves sales.

## Known current production blockers

- **As checked 13 Nov 2026:** live Shopify theme says `prelaunch`, `commerce_ready=false` and `lookbook_ready=false`.
- The Shopify deposit SKU is **ACTIVE** with an **availableForSale=true** variant and 50 tracked units; its direct product path is `/products/pham-001-priority-reservation`. Treat this as a potential checkout bypass, not proof that payment gateway was successfully charged.
- The connected Worker administrative secret and deployed D1 migration state were not available to this development session. The operational console is implemented, but a real production report cannot be generated or deployment confirmed.
- Physical production, legal signoffs, WhatsApp number and Lookbook fulfilment are not verified by unit tests.

## Tests

```bash
node --test backend/worker.test.mjs backend/card-manifest.test.mjs backend/identity-contact.test.mjs backend/operations-ledger.test.mjs backend/operator-console.test.mjs
python backend/check-schema.py
node scripts/check-campaign-safety.mjs
node scripts/check-performance-budget.mjs
```
