# PHAM / Edition 01 — controlled launch & legal review (13 November 2026)

**Status: PRELAUNCH. Do not turn on paid checkout simply because the site renders.** This is a technical preparation plan, not a legal opinion or proof of international compliance. The legal/commercial owner must review and approve the terms in every actual sales market.

## A. The intended one-action release

Release workflow: `.github/workflows/release-edition-01.yml` → Actions → **PHAM Edition 01 — Release Gate** → Run workflow with `mode=preflight` or `mode=launch`. The launch mode requires `confirmation=OPEN_EDITION_01` and explicitly configured production secrets.

The workflow tests the current repository; **pulls the currently live Shopify theme setting file read-only**; checks the live theme's `commerce_ready`, `lookbook_ready`, `engine_enabled`, Edition ID and size contract; verifies backend readiness and remote D1 migration; checks that D1 is still in `prelaunch` with zero reservations; checks operator approvals; only then performs the state transition `prelaunch → reservation_open`.

**Stage every dependency before pressing launch.** Do not set `commerce_ready` or `lookbook_ready` in production until the real digital content and checkout tests are complete, the backend is deployed and the state is definitely `prelaunch`. If the Worker currently reports `reservation_open`, an authenticated operator must safely return it to `prelaunch` while the site payment gates are closed and confirm no real paid reservations exist; this is an explicit reconciliation task, not a theme-only fix.

The workflow expects GitHub environment `pham-production`. It must be configured with appropriate environment approvals and secrets `CAMPAIGN_BACKEND_URL`, `INTERNAL_ADMIN_KEY`, `SHOPIFY_FLAG_STORE`, `SHOPIFY_CLI_THEME_TOKEN`. Each of the following environment secrets must literally be `APPROVED` **only after independent evidence is documented**: `PHAM_LEGAL_SIGNOFF`, `PHAM_PAYMENT_TEST_SIGNOFF`, `PHAM_LOOKBOOK_DELIVERY_SIGNOFF`, `PHAM_PRODUCTION_SIGNOFF`, `PHAM_SHIPPING_TAX_SIGNOFF`, `PHAM_DATA_PROTECTION_SIGNOFF`, `PHAM_THEME_DEPLOYED_SIGNOFF`, `PHAM_WEBHOOK_E2E_SIGNOFF`.

The workflow cannot repair missing legal registrations, create fabric or prove bank payouts. Missing approvals must stop the release rather than being bypassed.

## B. Physical collector card

Sequence: select preferred numbered jacket (01–50) → enter printable name (1–24 Unicode characters) → optional inscription (up to 40) → optional private production request (up to 240) → preview → review and submit.

The server validates all fields and authenticated entitlement before modifying the record. Preferred numbers are checked for conflicts in D1, and allocation is still subject to final operator confirmation and edition rules. The UI must not imply that selecting a number has guaranteed assignment before saving. Public identity display remains separately opt-in; private production notes are never exposed via the public provenance/QR record.

Migration `backend/migrations/0004_identity_production_notes.sql` is required **before** deploying the updated identity form/Worker to a live accepting state. Private operator list: `node backend/admin.mjs personalizations --edition=edition-01` with `CAMPAIGN_BACKEND_URL` and `INTERNAL_ADMIN_KEY`. Restrict operator logs, exports, retention and access. Do not email raw payment details.

## C. Required decisions and verification (operator/legal owner)

- **Seller and legal capacity:** verify who legally owns and operates the Shopify account, age/capacity and correct business or personal tax registration. Correct any outdated or placeholder business/VAT information; do not invent a registration number.
- **Vietnam e-commerce notification:** validate notification/registration duties under Law 122/2025/QH15 effective 1 July 2026 and Decree 248/2026/ND-CP. Complete the required notice and display any governmental verification badge **only after confirmed**, never use a fabricated badge.
- **Personal data:** review lawful purposes, transparent consent notices, data-subject rights and the handling of exported print instructions under Vietnam's Law on Personal Data Protection 91/2025/QH15 effective 1 January 2026, and local law of each target market. Verify incident response and deletion/retention policies.
- **Customer rights:** reconcile deposit, cancellation, failure-to-produce, return address, repair/replacement, and statutory withdrawal rights across Shopify Checkout policies and Edition Terms. For EU consumers, check 14-day withdrawal rules, statutory exceptions for truly personalized goods and the requirement for a clear electronic withdrawal interface. Personalized request forms do not automatically cancel mandatory rights.
- **Production promise:** approve final sample, actual measurements, 50-object MOQ, engraving method, identity-card print limits, package contents, one gold-tone/49 silver-tone rewards' legal/advertising treatment, and realistic shipment windows. Confirm the proposed reward arrangement is legally permitted before any public offer.
- **Payments and fulfillment:** verify a real supported payment provider can capture and refund USD; test actual shipping destinations, duties/taxes, email notifications and support escalation. Complete staged purchases: $24.99 deposit, $29.99 deposit+Identity, $174.01 balance with exact credit, and $199 standby route, plus failed/refunded/expired cases.
- **Live endpoints and operational security:** apply migration 0004, verify App Proxy, orders-paid and fulfillment webhook signatures/idempotency, retries, object number conflicts, authenticated collector data and complete lifecycle records. Reconcile the publicly accessible direct Shopify reservation SKU to prevent paid orders bypassing Edition Engine while the front-end is still gated.
- **Content and experience:** verify actual Digital Lookbook download and terms/consent, no placeholder public legal facts, all links and forms on mobile and desktop, focus states, accessibility, loading performance, and final marketing imagery versus approved sample.
- **EU electronic withdrawal:** the contact page includes request type and order reference; the Edition Terms link to the online form. This is a basic request channel **not yet proof of compliance** with Article 11a of Directive (EU) 2023/2673: the prominent, always-available withdrawal function, unambiguous 'confirm withdrawal' action and prompt durable acknowledgment containing submission time/content must be validated and implemented for applicable EU sales. Keep EU checkout closed until independently tested and legally signed off.

## D. Legal sources to review on launch day

1. Viet Nam Law on E-commerce (effective 01-07-2026), government presentation: https://en.baochinhphu.vn/viet-nams-law-on-e-commerce-111260825143234285.htm
2. Decree 248/2026/ND-CP official text: https://vanban.chinhphu.vn/?docid=218747&pageid=27160&typegroupid=4
3. Personal Data Protection Law No. 91/2025/QH15: https://bocongan.gov.vn/chinh-sach-phap-luat/co-so-du-lieu-van-ban/luat-bao-ve-du-lieu-ca-nhan-1753688803
4. EU Consumer Rights Directive 2011/83/EU: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex%3A32011L0083
5. EU consumers' distance selling returns: https://europa.eu/youreurope/citizens/consumers/shopping/returns/index_en.htm
6. EU Directive (EU) 2023/2673, online withdrawal function from June 2026: https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32023L2673
7. Shopify returns guidance: https://help.shopify.com/en/manual/fulfillment/managing-orders/returns/return-rules
8. Shopify store testing before launch: https://help.shopify.com/en/manual/intro-to-shopify/initial-setup/setup-prepare-for-launch/

**Never claim full legal compliance merely because templates exist.** Record independent counsel review or an accountable merchant decision for each actual target country.
