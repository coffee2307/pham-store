import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { InMemoryStore } from '../src/adapters/in-memory-store.js';
import { EditionEngine } from '../src/services/edition-engine.js';
import { CampaignState } from '../src/domain/rules.js';
import { handleOrdersPaidWebhook } from '../src/shopify/orders-paid.js';

function webhookPayload({ referralCode = '', customer = 2, order = 2 } = {}) {
  return {
    admin_graphql_api_id: `gid://shopify/Order/${order}`,
    financial_status: 'paid',
    processed_at: '2026-10-05T12:00:00Z',
    email: `collector${customer}@example.com`,
    currency: 'USD',
    customer: {
      admin_graphql_api_id: `gid://shopify/Customer/${customer}`,
      email: `collector${customer}@example.com`,
    },
    line_items: [
      {
        sku: 'PHAM-001-RES-E01',
        price: '24.99',
        properties: [
          { name: '_PHAM Edition', value: 'EDITION 01' },
          { name: '_PHAM Product', value: 'PHAM-001' },
          { name: '_PHAM Referral Code', value: referralCode },
          { name: 'Reservation terms', value: 'Accepted' },
          { name: 'Digital lookbook delivery', value: 'Included' },
        ],
      },
      { sku: 'PHAM-LOOKBOOK-E01', price: '0.00', properties: [] },
      { sku: 'PHAM-ID-E01', price: '5.00', properties: [] },
    ],
  };
}

function signedBody(payload, secret) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const hmacHeader = createHmac('sha256', secret).update(rawBody).digest('base64');
  return { rawBody, hmacHeader };
}

test('paid reservation webhook creates reservation and resolves paid + referral Identity claims', async () => {
  const editionRecord = {
    id: 'edition-01',
    label: 'EDITION 01',
    productCode: 'PHAM-001',
    state: CampaignState.RESERVATION_OPEN,
    commerceReady: true,
    editionSize: 50,
    reservationsClaimed: 0,
    identityLimit: 2,
    identityClaimed: 0,
  };

  const store = new InMemoryStore({ editions: [editionRecord] });
  const engine = new EditionEngine(store);

  const referrer = await engine.activateReservation({
    editionId: 'edition-01',
    reservationId: 'R-REFERRER',
    customerId: 'gid://shopify/Customer/1',
    shopifyOrderId: 'gid://shopify/Order/1',
    reservationPaidCents: 2499,
  });

  const secret = 'webhook-secret';
  const signed = signedBody(
    webhookPayload({ referralCode: referrer.collectorReferralCode }),
    secret
  );

  const response = await handleOrdersPaidWebhook({
    ...signed,
    webhookSecret: secret,
    engine,
    store,
    edition: { ...editionRecord, includeLookbook: true },
    skus: {
      reservationSku: 'PHAM-001-RES-E01',
      identitySku: 'PHAM-ID-E01',
      lookbookSku: 'PHAM-LOOKBOOK-E01',
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.identity.source, 'paid');
  assert.equal(response.body.referral.verified, true);

  const edition = await store.getEdition('edition-01');
  assert.equal(edition.reservationsClaimed, 2);
  assert.equal(edition.identityClaimed, 2);

  const referrerIdentity = await store.getIdentityPrivilege('R-REFERRER');
  assert.equal(referrerIdentity.source, 'referral');
});

test('duplicate paid webhook does not consume another reservation slot', async () => {
  const editionRecord = {
    id: 'edition-01',
    state: CampaignState.RESERVATION_OPEN,
    commerceReady: true,
    editionSize: 50,
    reservationsClaimed: 0,
    identityLimit: 15,
    identityClaimed: 0,
  };

  const store = new InMemoryStore({ editions: [editionRecord] });
  const engine = new EditionEngine(store);
  const secret = 'webhook-secret';
  const payload = webhookPayload({ referralCode: '', customer: 9, order: 9 });
  payload.line_items = payload.line_items.filter((item) => item.sku !== 'PHAM-ID-E01');
  const signed = signedBody(payload, secret);

  const args = {
    ...signed,
    webhookSecret: secret,
    engine,
    store,
    edition: { ...editionRecord, includeLookbook: true },
    skus: {
      reservationSku: 'PHAM-001-RES-E01',
      identitySku: 'PHAM-ID-E01',
      lookbookSku: 'PHAM-LOOKBOOK-E01',
    },
  };

  const first = await handleOrdersPaidWebhook(args);
  const second = await handleOrdersPaidWebhook(args);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);

  const edition = await store.getEdition('edition-01');
  assert.equal(edition.reservationsClaimed, 1);
});
