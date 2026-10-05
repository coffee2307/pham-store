import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStandbyDraftOrderInput,
  buildStandbyInvoiceEmail,
} from '../src/shopify/standby-payment.js';

test('standby offer is full price with no reservation credit', () => {
  const deadline = '2026-11-15T11:00:00.000Z';

  const built = buildStandbyDraftOrderInput({
    customerId: 'gid://shopify/Customer/9',
    email: 'standby@example.com',
    productVariantId: 'gid://shopify/ProductVariant/PHAM001',
    standbyEntryId: 'STANDBY-0001',
    editionLabel: 'EDITION 01',
    productCode: 'PHAM-001',
    offerDeadline: deadline,
  });

  assert.equal(built.input.appliedDiscount, undefined);
  assert.equal(built.input.acceptAutomaticDiscounts, false);
  assert.equal(built.input.allowDiscountCodesInCheckout, false);
  assert.equal(built.input.reserveInventoryUntil, deadline);
  assert.equal(
    built.input.customAttributes.find((x) => x.key === 'PHAM Acquisition Type').value,
    'Standby full price'
  );
});

test('standby email states full $199 price and 48h-style deadline', () => {
  const email = buildStandbyInvoiceEmail({
    email: 'standby@example.com',
    editionLabel: 'EDITION 01',
    productCode: 'PHAM-001',
    finalPriceCents: 19900,
    offerDeadline: '2026-11-15T11:00:00.000Z',
    currencyCode: 'USD',
  });

  assert.match(email.customMessage, /\$199\.00/);
  assert.match(email.customMessage, /full product price/);
});
