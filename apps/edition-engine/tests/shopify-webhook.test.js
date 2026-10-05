import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  extractReservationOrder,
  isPaidOrder,
  verifyShopifyWebhook,
} from '../src/shopify/webhook.js';

test('Shopify webhook HMAC verification accepts valid signature', () => {
  const secret = 'unit-test-secret';
  const rawBody = Buffer.from('{"id":123,"financial_status":"paid"}');
  const hmac = createHmac('sha256', secret).update(rawBody).digest('base64');

  assert.equal(verifyShopifyWebhook(rawBody, hmac, secret), true);
  assert.equal(verifyShopifyWebhook(rawBody, 'invalid', secret), false);
});

test('reservation order mapper extracts reservation, identity, lookbook and referral metadata', () => {
  const order = {
    admin_graphql_api_id: 'gid://shopify/Order/1',
    financial_status: 'paid',
    email: 'collector@example.com',
    currency: 'USD',
    customer: {
      admin_graphql_api_id: 'gid://shopify/Customer/1',
      email: 'collector@example.com',
    },
    line_items: [
      {
        sku: 'PHAM-001-RES-E01',
        price: '24.99',
        properties: [
          { name: '_PHAM Edition', value: 'EDITION 01' },
          { name: '_PHAM Product', value: 'PHAM-001' },
          { name: '_PHAM Referral Code', value: 'ABC12345' },
          { name: '_PHAM Size Preference', value: 'M' },
          { name: 'Reservation terms', value: 'Accepted' },
          { name: 'Digital lookbook delivery', value: 'Included' },
        ],
      },
      { sku: 'PHAM-LOOKBOOK-E01', price: '0.00', properties: [] },
      { sku: 'PHAM-ID-E01', price: '5.00', properties: [] },
    ],
  };

  const mapped = extractReservationOrder(order, {
    reservationSku: 'PHAM-001-RES-E01',
    identitySku: 'PHAM-ID-E01',
    lookbookSku: 'PHAM-LOOKBOOK-E01',
  });

  assert.equal(mapped.shopifyOrderId, 'gid://shopify/Order/1');
  assert.equal(mapped.shopifyCustomerId, '1');
  assert.equal(mapped.reservationAmount, '24.99');
  assert.equal(mapped.editionLabel, 'EDITION 01');
  assert.equal(mapped.productCode, 'PHAM-001');
  assert.equal(mapped.referralCode, 'ABC12345');
  assert.equal(mapped.sizePreference, 'M');
  assert.equal(mapped.termsAccepted, true);
  assert.equal(mapped.digitalLookbookRequested, true);
  assert.equal(mapped.identitySelected, true);
  assert.equal(mapped.lookbookIncluded, true);
  assert.equal(isPaidOrder(order), true);
});

test('non-reservation Shopify orders are ignored by reservation mapper', () => {
  const order = {
    financial_status: 'paid',
    line_items: [{ sku: 'OTHER-SKU', price: '10.00', properties: [] }],
  };

  const mapped = extractReservationOrder(order, {
    reservationSku: 'PHAM-001-RES-E01',
  });

  assert.equal(mapped, null);
});


test('partially paid order is not accepted as a completed campaign payment', () => {
  assert.equal(isPaidOrder({ financial_status: 'partially_paid' }), false);
  assert.equal(isPaidOrder({ financial_status: 'paid' }), true);
});
