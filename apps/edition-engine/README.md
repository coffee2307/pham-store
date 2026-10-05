# PHAM Edition Engine Reference

This directory is the domain/reference implementation for PHAM numbered-edition rules.

It is **not** a second production backend and must not hold live campaign state.

## Runtime boundary

Production/staging runtime:

- `backend/worker.js`
- Cloudflare Worker
- Cloudflare D1
- Shopify App Proxy
- Shopify webhooks

Reference/domain suite:

- `apps/edition-engine/src/domain`
- `apps/edition-engine/src/services`
- in-memory/PostgreSQL adapters
- unit tests for reservation/referral/identity/final-payment/standby rules

The reference suite exists to keep business rules explicit and testable. The Cloudflare Worker is the only live state authority once deployed.

Do not deploy both the PostgreSQL adapter and D1 Worker against the same edition.

When a business rule changes, update both:

1. the domain/reference tests;
2. the production Worker behavior.

The CI suite runs both to catch obvious regressions. D1 schema consistency is checked separately against migrations.
