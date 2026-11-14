# PHAM-001 — PRELAUNCH / 14-DAY INTAKE / PAYMENT & NOTIFICATIONS
Date: 2026-11-13. Mode: **PREPARATION ONLY**. No production payments or refunds were processed by implementing this code.

## 1. Immediate critical checkout bypass: Shopify catalog

Last read in connected Shopify Admin: `gid://shopify/Product/10200565776640`, `PHAM-001 — Jacket Deposit`, SKU `PHAM-001-RES-E01`, **ACTIVE**, `availableForSale=true`, 50 units, $24.99. Published simultaneously to Online Store, Google & YouTube, TikTok, Facebook & Instagram.

Shopify's connected mutation `publishableUnpublish` was **refused by the connector's safety policy**. That is NOT completed. Do not say this SKU has been unpublished or that direct checkout has been blocked in Shopify.

**The merchant must make the catalog change in Shopify Admin** before continuing:
1. Open Shopify Admin → **Products** → **PHAM-001 — Jacket Deposit**.
2. In **Publishing / Sales channels and apps**, remove the deposit from **Online Store**, **Google & YouTube**, **TikTok**, and **Facebook & Instagram** for the prelaunch period, or use Shopify Admin's equivalent draft status if appropriate for the merchant's product configuration.
3. Save; then verify the direct URL `/products/pham-001-priority-reservation` is no longer purchasable and variant availability is not exposed to public checkout. Do not rely solely on a redirect or hidden Buy button.
4. Audit any other active deposit/Identity SKUs, carts, Buy Buttons and external channels that might collect money out of process.
5. Only republish the correct products as part of the independently signed-off **launch** sequence. A published item can charge a card before Worker webhook validation; backend checks cannot reverse that charge.

Until this is done, the storefront live theme remains `prelaunch` but direct-purchase risk persists.

## 2. Deadline: maximum 14 × 24 hours from actual authenticated opening

D1 migration `0007_reservation_window_underfill.sql` stores `reservation_opened_at`, `reservation_closes_at`, `reservation_closed_at`, `reservation_window_days` (default and maximum **14**), the actual approved `release_quantity`, and operator evidence for a smaller run.

When `prelaunch → reservation_open` is permitted by all gates, the Worker records immutable start/deadline timestamps in UTC. Every paid deposit webhook requires the independent intake gate **and** a valid unexpired reservation window, whether or not cron has executed. Cron closes the intake and writes a review event.

If 50 reservations arrive sooner, the state changes to `reservation_full` and intake closes. If fewer than 50 arrive at the deadline, it becomes `reservation_closed`, stops taking deposits, and **requires an explicit merchant decision**. It does not automatically send final invoices or give up any customer's paid deposit.

### Decision A: produce a smaller issued set

Allowed only when **all** are true: merchant accepts the smaller actual run; factory confirms units/costs/materials; updated customer disclosures/consumer rights are reviewed; customers are notified of material changes; legal and manufacturing signoffs and an external case reference are recorded. Command:
```
node backend/admin.mjs close-underfilled \
  --decision=proceed_partial \
  --reference=PHAM-APPROVED-UNDERFILL-REFERENCE \
  --production-approved --legal-approved --customer-notice-approved --confirm
```
PHAM retains the edition maximum of 50, but only actual paid/approved units are `release_quantity`. Unissued numbers remain unissued. A later final invoice for each eligible reservation remains operator-triggered with `node backend/admin.mjs open-final-payment --confirm`, and never starts by itself. **If a lower run materially affects the promised 49-silver / 1-gold token distribution, inform customers and resolve legality before confirming the partial run.** The code allocates one gold and `release_quantity-1` silver-tone tokens among actually issued pieces. No manufacture is initiated automatically.

### Decision B: cancel and put every order into refund review

```
node backend/admin.mjs close-underfilled \
  --decision=refund_review --reference=PHAM-REFUND-REVIEW-REFERENCE --confirm
node backend/admin.mjs refund-reviews
```
Each paid deposit creates an operator-only refund-review case. **No Shopify refund API is called by this operation**. Merchant must review and refund valid payments in Shopify Admin, including optional $5 Identity and any applicable amount/rights. After verifying an actual Shopify refund, record it:
```
node backend/admin.mjs attest-refund \
  --reservation=PHAM-R-... \
  --refund-reference=ACTUAL-SHOPIFY-REFUND-REFERENCE \
  --refunded-in-shopify --confirm
```
The record is an operator attestation, **not independently verifiable evidence of bank settlement**; review Shopify evidence first. A zero-order launch cancels without creating a fake refund.

**Never** replace these choices with silently holding a customer's deposit past the disclosed window.

## 3. Transactional notification outbox and Lookbook

D1 migration `0008_notice_outbox_lookbook_proof.sql` creates `customer_notification_jobs` and a separate Lookbook delivery-evidence reference. Events are keyed per reservation and type, not by email addresses, and are idempotent.

Current notice event types: reservation confirmed, reservation-window closed, refund-review pending, refund recorded, final acquisition paid, Lookbook delivered, Identity confirmed, production started, QC, packed, dispatched, delivered, 24-hour and 3-hour remaining payment reminder. Shopify sends final invoice using its existing Draft Order invoice mutation — this is not duplicated by custom notices.

All custom emails are **OFF by default**. To enable only after verifying domain ownership, SMTP/API provider permissions, lawful transactional messaging and deliverability:
- Cloudflare Worker secret `PHAM_RESEND_API_KEY=re_...` (never commit it);
- `PHAM_NOTIFICATION_FROM=PHAM <updates@phamofficial.com>` with a sender domain verified at the provider;
- `PHAM_NOTIFICATIONS_ENABLED=true`;
- `STOREFRONT_ORIGIN=https://phamofficial.com`.
- Test receipt on at least one authorized non-customer test email, monitor unsubscribe/privacy requirements where applicable, provider errors and retry policies.

The Worker uses the documented Resend HTTPS send-email endpoint and an idempotency key. It never auto-retries an ambiguous failed send, instead marking it `needs_review` for reconciliation; this helps prevent duplicate notifications.
Admin: `node backend/admin.mjs notifications` and `node backend/admin.mjs dispatch-notifications --confirm`. Unresolved failures block release preflight.

**Lookbook**: `entitled` simply means a paid reservation is eligible, **not that the file was delivered**. Staff must actually deliver a verified production Lookbook file/link, collect evidence of successful delivery, then mark:
```
node backend/admin.mjs mark-lookbook \
  --reservation=PHAM-R-... --status=delivered \
  --delivery-verified --delivery-reference=ACTUAL-DELIVERY-EVIDENCE
```
The Worker rejects a delivered status without explicit evidence. The email notification is a receipt/confirmation, not the content-delivery mechanism itself. A real secure Lookbook portal/download and end-to-end delivery confirmation still need merchant-owned hosting/assets.

## 3A. Guest checkout: access to the collector record

A Shopify order without a bound Shopify Customer GID must **not** be claimed automatically by guessing the email address. If a paid guest buyer later registers or signs in, PHAM support verifies the buyer's original Shopify order, the identity of the claimant and a recorded support case. The authenticated Worker then rechecks the account via Shopify Admin: `verifiedEmail=true` and the exact `defaultEmailAddress.emailAddress` must match the original order email; the reservation must not already be linked or cancelled. Operator command:

```bash
node backend/admin.mjs link-guest-order \
  --reservation=PHAM-R-... \
  --customer=gid://shopify/Customer/123... \
  --case-reference=PHAM-VERIFIED-SUPPORT-CASE-123 \
  --confirm
```

The link is written once and its support reference is recorded privately. Customers cannot call this operator endpoint. Account linking requires a real support workflow, not merely a matching unverified email.

## 4. Non-production dry-run versus real end-to-end tests

The repository's automated test suite includes `backend/end-to-end-simulation.test.mjs` for a **simulated** deposit → $174.01 final invoice → lifecycle → delivery and underfilled refusal, plus notification transport mocks and deadline tests. This is not proof of a real payment gateway, actual customer email delivery, bank settlement, real shipping, or production xưởng.

Mandatory real prelaunch acceptance (performed by an authorized adult merchant in a legally compliant test setting):
1. Confirm no publicly purchasable deposit remains while `prelaunch`; test direct product and checkout from fresh browser.
2. Run a controlled eligible reservation checkout in a **Shopify test environment** with buyer account, M/L/XL/XXL; confirm exact $24.99 and optional $5 without any captured live-money charge.
3. Verify signed webhook and App Proxy, one active reservation per customer, no duplicate/race or 51st allocation; test a guest-to-account support reconciliation.
4. Verify the Lookbook was actually received (not only `entitled`) and the appropriate message logs as `sent`.
5. Confirm Identity email/WhatsApp customer actually sent, operator confirmed before engraving, and preferred number collision is rejected.
6. Test a pre-approved full run and a separately approved partial run. Force a simulated 14-day expiry with 0, 20 and 50 reservations in isolated staging; verify no further payments and no silent refund.
7. Test the exact $199 variant mapped to each recorded size, $24.99 once-only credit, signed $174.01 invoice, 72-hour expiry, 24-hour/3-hour notices, failed/late payment and lawful refund.
8. Progress **production_queued → in_production → quality_control → packed → dispatched → delivered** only with actual staff/QC attestations; test Shopify Fulfillment events, tracking, Birth Record/QR, Founder’s Token legal approval and recipient privacy.
9. Verify support responses, shipping/taxes/returns rules, disclosure of potential >64-day wait, final physical sample and factory production capacity, legal merchant identity, and cost/risk of partial runs.
10. Document each pass/fail result and operator signoff before configuring the GitHub `pham-production` environment and unlocking the release action.

New release-gate signoffs: `PHAM_DEPOSIT_CATALOG_SIGNOFF`, `PHAM_UNDERFILL_REFUND_SIGNOFF`, `PHAM_NOTIFICATION_E2E_SIGNOFF`; each value is `APPROVED` only after external evidence, never merely to unblock CI.

## 5. Actual deployment status

This is **development branch code**, not confirmation that Cloudflare production D1 has been migrated, Worker deployed, Shopify email/Lookbook delivery configured or product unpublished. The live Shopify theme is left unchanged, and opening payments is not authorized. Apply migrations `0004` → `0008` in the correct remote order after reconciling existing production schema, then deploy the Worker, test, stage only the unpublished theme, and run readiness checks. Updating a Shopify preview theme does not deploy the Cloudflare Worker.
