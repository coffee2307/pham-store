import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinalAcquisitionDraftInput,
  assertDraftOrderPricing,
  buildStandbyAcquisitionDraftInput,
  canonicalizeAppProxyParams,
  evaluateFinalSizeVariants,
  parseEditionSizeOptions,
  selectFinalVariantBySize,
  validateFinalAcquisitionOrder,
  validatePriorityReservationOrder,
  validateStandbyAcquisitionOrder,
  verifyAppProxyRequest,
  verifyShopifyWebhook,
} from './worker.js';

test('canonicalizes Shopify App Proxy params including duplicate keys', () => {
  const url = new URL(
    'https://proxy.example/status?' +
    'extra=1&extra=2&' +
    'shop=example.myshopify.com&' +
    'logged_in_customer_id=1&' +
    'path_prefix=%2Fapps%2Fawesome_reviews&' +
    'timestamp=1317327555&' +
    'signature=ignored'
  );

  assert.equal(
    canonicalizeAppProxyParams(url),
    'extra=1,2' +
    'logged_in_customer_id=1' +
    'path_prefix=/apps/awesome_reviews' +
    'shop=example.myshopify.com' +
    'timestamp=1317327555'
  );
});

test('canonicalization excludes signature and preserves empty customer id', () => {
  const url = new URL(
    'https://proxy.example/status?' +
    'shop=example.myshopify.com&' +
    'logged_in_customer_id=&' +
    'path_prefix=%2Fapps%2Fpham-edition&' +
    'timestamp=1317327555&' +
    'signature=ignored'
  );

  const canonical = canonicalizeAppProxyParams(url);
  assert.ok(!canonical.includes('signature='));
  assert.ok(canonical.includes('logged_in_customer_id='));
  assert.ok(canonical.includes('path_prefix=/apps/pham-edition'));
});


async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  );
  return Array.from(signed, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacBase64(secret, bytes) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signed = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, bytes)
  );
  return Buffer.from(signed).toString('base64');
}

test('verifies a valid Shopify App Proxy signature and binds the expected shop', async () => {
  const secret = 'test-app-secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(
    'https://worker.example/status?' +
    'logged_in_customer_id=12345&' +
    'path_prefix=%2Fapps%2Fpham-edition&' +
    'shop=phamofficial.myshopify.com&' +
    'timestamp=' + timestamp
  );

  const signature = await hmacHex(secret, canonicalizeAppProxyParams(url));
  url.searchParams.set('signature', signature);

  const result = await verifyAppProxyRequest(
    url,
    secret,
    'phamofficial.myshopify.com'
  );

  assert.equal(result.ok, true);
  assert.equal(result.customerId, 'gid://shopify/Customer/12345');
  assert.equal(result.shop, 'phamofficial.myshopify.com');
});

test('rejects an App Proxy request for the wrong shop', async () => {
  const secret = 'test-app-secret';
  const timestamp = Math.floor(Date.now() / 1000);
  const url = new URL(
    'https://worker.example/status?' +
    'logged_in_customer_id=&' +
    'path_prefix=%2Fapps%2Fpham-edition&' +
    'shop=other-shop.myshopify.com&' +
    'timestamp=' + timestamp
  );

  const signature = await hmacHex(secret, canonicalizeAppProxyParams(url));
  url.searchParams.set('signature', signature);

  const result = await verifyAppProxyRequest(
    url,
    secret,
    'phamofficial.myshopify.com'
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_shop');
  assert.equal(result.status, 401);
});

test('rejects stale App Proxy requests', async () => {
  const secret = 'test-app-secret';
  const timestamp = Math.floor(Date.now() / 1000) - 3600;
  const url = new URL(
    'https://worker.example/status?' +
    'logged_in_customer_id=12345&' +
    'path_prefix=%2Fapps%2Fpham-edition&' +
    'shop=phamofficial.myshopify.com&' +
    'timestamp=' + timestamp
  );

  const signature = await hmacHex(secret, canonicalizeAppProxyParams(url));
  url.searchParams.set('signature', signature);

  const result = await verifyAppProxyRequest(
    url,
    secret,
    'phamofficial.myshopify.com'
  );

  assert.equal(result.ok, false);
  assert.equal(result.error, 'stale_request');
  assert.equal(result.status, 401);
});

test('verifies Shopify webhook HMAC against the raw request bytes', async () => {
  const secret = 'test-webhook-secret';
  const raw = new TextEncoder().encode('{"id":123,"email":"collector@example.com"}');
  const signature = await hmacBase64(secret, raw);

  assert.equal(
    await verifyShopifyWebhook(raw, signature, secret),
    true
  );

  assert.equal(
    await verifyShopifyWebhook(raw, signature + 'tampered', secret),
    false
  );
});


test('final acquisition draft uses the reservation-specific mapped variant', () => {
  const input = buildFinalAcquisitionDraftInput({
    edition: {
      label: 'EDITION 01',
      product_code: 'PHAM-001',
      currency_code: 'USD',
      reservation_price_cents: 2499,
      final_product_variant_id: 'gid://shopify/ProductVariant/DEFAULT',
    },
    reservation: {
      id: 'PHAM-R-TEST',
      email: 'collector@example.com',
      shopify_customer_id: 'gid://shopify/Customer/42',
      size_preference: 'M',
    },
    deadline: '2026-11-13T11:00:00.000Z',
    variantId: 'gid://shopify/ProductVariant/SIZE-M',
  });

  assert.equal(
    input.lineItems[0].variantId,
    'gid://shopify/ProductVariant/SIZE-M'
  );
  assert.notEqual(
    input.lineItems[0].variantId,
    'gid://shopify/ProductVariant/DEFAULT'
  );
  assert.deepEqual(
    input.customAttributes.find(attribute => attribute.key === 'PHAM Size Preference'),
    { key: 'PHAM Size Preference', value: 'M' }
  );
  assert.deepEqual(input.purchasingEntity, {
    customerId: 'gid://shopify/Customer/42'
  });
});

test('final acquisition draft fails closed when no final variant is available', () => {
  assert.throws(
    () => buildFinalAcquisitionDraftInput({
      edition: {
        label: 'EDITION 01',
        product_code: 'PHAM-001',
        reservation_price_cents: 2499,
      },
      reservation: { id: 'PHAM-R-TEST' },
      deadline: '2026-11-13T11:00:00.000Z',
      variantId: '',
    }),
    /missing_final_variant_id/
  );
});


function finalPaymentFixture() {
  return {
    edition: {
      currency_code: 'USD',
      final_price_cents: 19900,
      reservation_price_cents: 2499,
      final_product_variant_id: 'gid://shopify/ProductVariant/100',
    },
    reservation: {
      id: 'PHAM-R-TEST',
      status: 'final_payment_open',
      shopify_customer_id: 'gid://shopify/Customer/42',
      final_variant_id: 'gid://shopify/ProductVariant/200',
      payment_deadline: '2026-11-13T11:00:00.000Z',
    },
    order: {
      id: 900,
      currency: 'USD',
      processed_at: '2026-11-13T10:59:00.000Z',
      current_total_discounts: '24.99',
      customer: { id: 42 },
      line_items: [
        {
          variant_id: 200,
          quantity: 1,
          price: '199.00',
          sku: 'PHAM-001-E01-M',
        },
      ],
    },
  };
}

test('validates final acquisition against mapped variant, collector, price, credit and deadline', () => {
  const fixture = finalPaymentFixture();
  const result = validateFinalAcquisitionOrder(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.variantId, 'gid://shopify/ProductVariant/200');
  assert.equal(result.discountCents, 2499);
});

test('rejects final acquisition paid after the reservation deadline', () => {
  const fixture = finalPaymentFixture();
  fixture.order.processed_at = '2026-11-13T11:00:01.000Z';

  assert.throws(
    () => validateFinalAcquisitionOrder(fixture),
    /payment_window_expired/
  );
});

test('rejects a final acquisition for the wrong size-mapped variant', () => {
  const fixture = finalPaymentFixture();
  fixture.order.line_items[0].variant_id = 100;

  assert.throws(
    () => validateFinalAcquisitionOrder(fixture),
    /final_variant_mismatch/
  );
});

test('rejects a final acquisition when reservation credit was not applied exactly once', () => {
  const fixture = finalPaymentFixture();
  fixture.order.current_total_discounts = '0.00';

  assert.throws(
    () => validateFinalAcquisitionOrder(fixture),
    /reservation_credit_mismatch/
  );
});

test('rejects a final acquisition paid by a different Shopify customer', () => {
  const fixture = finalPaymentFixture();
  fixture.order.customer.id = 99;

  assert.throws(
    () => validateFinalAcquisitionOrder(fixture),
    /final_payment_customer_mismatch/
  );
});


function priorityReservationFixture({ identity = true } = {}) {
  const lineItems = [
    {
      sku: 'PHAM-001-RES-E01',
      quantity: 1,
      price: '24.99',
      properties: [
        { name: '_PHAM Edition', value: 'EDITION 01' },
        { name: '_PHAM Product', value: 'PHAM-001' },
        { name: '_PHAM Referral Code', value: '' },
        { name: '_PHAM Size Preference', value: 'M' },
        { name: 'Reservation terms', value: 'Accepted' },
        { name: 'Digital lookbook delivery', value: 'Included' },
      ],
    },
    {
      sku: 'PHAM-LOOKBOOK-E01',
      quantity: 1,
      price: '0.00',
      properties: [],
    },
  ];

  if (identity) {
    lineItems.push({
      sku: 'PHAM-ID-E01',
      quantity: 1,
      price: '5.00',
      properties: [],
    });
  }

  return {
    edition: {
      id: 'edition-01',
      label: 'EDITION 01',
      product_code: 'PHAM-001',
      currency_code: 'USD',
      reservation_price_cents: 2499,
    },
    order: {
      id: 1001,
      financial_status: 'paid',
      currency: 'USD',
      current_total_discounts: '0.00',
      current_subtotal_price: identity ? '29.99' : '24.99',
      line_items: lineItems,
    },
  };
}

test('validates the exact Priority Reservation bundle before allocation', () => {
  const fixture = priorityReservationFixture();
  const result = validatePriorityReservationOrder(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.sizePreference, 'M');
  assert.equal(result.reservationPaidCents, 2499);
  assert.equal(result.identityLine.sku, 'PHAM-ID-E01');
});

test('rejects Priority Reservation checkout without a size preference', () => {
  const fixture = priorityReservationFixture();
  const reservationLine = fixture.order.line_items[0];
  reservationLine.properties = reservationLine.properties.map(property =>
    property.name === '_PHAM Size Preference'
      ? { ...property, value: '' }
      : property
  );

  assert.throws(
    () => validatePriorityReservationOrder(fixture),
    /missing_size_preference/
  );
});

test('rejects discounted or mixed-cart Priority Reservation orders', () => {
  const discounted = priorityReservationFixture();
  discounted.order.current_total_discounts = '1.00';
  assert.throws(
    () => validatePriorityReservationOrder(discounted),
    /reservation_discount_not_allowed/
  );

  const mixed = priorityReservationFixture();
  mixed.order.line_items.push({
    sku: 'UNRELATED-SKU',
    quantity: 1,
    price: '10.00',
    properties: [],
  });
  mixed.order.current_subtotal_price = '39.99';
  assert.throws(
    () => validatePriorityReservationOrder(mixed),
    /unexpected_reservation_line_item/
  );
});

test('rejects malformed Identity and Lookbook add-ons', () => {
  const identity = priorityReservationFixture();
  identity.order.line_items.find(line => line.sku === 'PHAM-ID-E01').price = '4.00';
  assert.throws(
    () => validatePriorityReservationOrder(identity),
    /identity_price_mismatch/
  );

  const lookbook = priorityReservationFixture({ identity: false });
  lookbook.order.line_items = lookbook.order.line_items.filter(
    line => line.sku !== 'PHAM-LOOKBOOK-E01'
  );
  assert.throws(
    () => validatePriorityReservationOrder(lookbook),
    /invalid_lookbook_line_count/
  );
});

test('selects one final Shopify variant by exact Size option and price', () => {
  const selected = selectFinalVariantBySize([
    {
      id: 'gid://shopify/ProductVariant/S',
      price: '199.00',
      selectedOptions: [{ name: 'Size', value: 'S' }],
    },
    {
      id: 'gid://shopify/ProductVariant/M',
      price: '199.00',
      selectedOptions: [{ name: 'Size', value: 'M' }],
    },
  ], 'm', 19900);

  assert.equal(selected.id, 'gid://shopify/ProductVariant/M');
});

test('standby draft uses sized variant and binds the queued Shopify customer', () => {
  const input = buildStandbyAcquisitionDraftInput({
    edition: {
      label: 'EDITION 01',
      product_code: 'PHAM-001',
    },
    standby: {
      id: 'standby-1',
      email: 'standby@example.com',
      customer_id: 'gid://shopify/Customer/77',
      size_preference: 'L',
    },
    deadline: '2026-11-15T10:00:00.000Z',
    variantId: 'gid://shopify/ProductVariant/L',
  });

  assert.equal(input.lineItems[0].variantId, 'gid://shopify/ProductVariant/L');
  assert.deepEqual(input.purchasingEntity, {
    customerId: 'gid://shopify/Customer/77'
  });
  assert.deepEqual(
    input.customAttributes.find(attribute => attribute.key === 'PHAM Size Preference'),
    { key: 'PHAM Size Preference', value: 'L' }
  );
});

function standbyPaymentFixture() {
  return {
    edition: {
      currency_code: 'USD',
      final_price_cents: 19900,
      final_product_variant_id: 'gid://shopify/ProductVariant/DEFAULT',
    },
    standby: {
      id: 'standby-1',
      status: 'promoted',
      email: 'standby@example.com',
      customer_id: 'gid://shopify/Customer/77',
      size_preference: 'L',
      final_variant_id: 'gid://shopify/ProductVariant/300',
      offer_deadline: '2026-11-15T10:00:00.000Z',
    },
    order: {
      id: 2002,
      currency: 'USD',
      processed_at: '2026-11-15T09:59:00.000Z',
      current_total_discounts: '0.00',
      current_subtotal_price: '199.00',
      customer: {
        id: 77,
        email: 'standby@example.com',
      },
      email: 'standby@example.com',
      line_items: [
        {
          variant_id: 300,
          quantity: 1,
          price: '199.00',
          sku: 'PHAM-001-E01-L',
        },
      ],
    },
  };
}

test('validates a standby acquisition against offer, size variant, price and customer', () => {
  const fixture = standbyPaymentFixture();
  const result = validateStandbyAcquisitionOrder(fixture);

  assert.equal(result.ok, true);
  assert.equal(result.variantId, 'gid://shopify/ProductVariant/300');
});

test('rejects expired, discounted, or wrong-variant standby acquisition', () => {
  const expired = standbyPaymentFixture();
  expired.order.processed_at = '2026-11-15T10:00:01.000Z';
  assert.throws(
    () => validateStandbyAcquisitionOrder(expired),
    /standby_offer_expired/
  );

  const discounted = standbyPaymentFixture();
  discounted.order.current_total_discounts = '10.00';
  assert.throws(
    () => validateStandbyAcquisitionOrder(discounted),
    /standby_discount_not_allowed/
  );

  const wrongVariant = standbyPaymentFixture();
  wrongVariant.order.line_items[0].variant_id = 301;
  assert.throws(
    () => validateStandbyAcquisitionOrder(wrongVariant),
    /standby_variant_mismatch/
  );
});


test('parses edition size options and removes blanks or duplicates', () => {
  assert.deepEqual(
    parseEditionSizeOptions(' XS, S, M, M, L, XL, '),
    ['XS', 'S', 'M', 'L', 'XL']
  );
});

test('readiness requires exactly one correctly priced final variant per configured size', () => {
  const variants = [
    { id: 'XS', sku: 'PHAM-001-E01-XS', price: '199.00', selectedOptions: [{ name: 'Size', value: 'XS' }] },
    { id: 'S', sku: 'PHAM-001-E01-S', price: '199.00', selectedOptions: [{ name: 'Size', value: 'S' }] },
    { id: 'M', sku: 'PHAM-001-E01-M', price: '199.00', selectedOptions: [{ name: 'Size', value: 'M' }] },
    { id: 'L', sku: 'PHAM-001-E01-L', price: '199.00', selectedOptions: [{ name: 'Size', value: 'L' }] },
    { id: 'XL', sku: 'PHAM-001-E01-XL', price: '199.00', selectedOptions: [{ name: 'Size', value: 'XL' }] },
  ];

  const result = evaluateFinalSizeVariants(
    variants,
    ['XS', 'S', 'M', 'L', 'XL'],
    19900
  );

  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 5);
});

test('readiness fails when a configured size is missing, duplicated, or mispriced', () => {
  const missing = evaluateFinalSizeVariants([
    { id: 'S', sku: 'S', price: '199.00', selectedOptions: [{ name: 'Size', value: 'S' }] },
  ], ['S', 'M'], 19900);
  assert.equal(missing.ok, false);

  const duplicated = evaluateFinalSizeVariants([
    { id: 'M1', sku: 'M1', price: '199.00', selectedOptions: [{ name: 'Size', value: 'M' }] },
    { id: 'M2', sku: 'M2', price: '199.00', selectedOptions: [{ name: 'Size', value: 'M' }] },
  ], ['M'], 19900);
  assert.equal(duplicated.ok, false);

  const mispriced = evaluateFinalSizeVariants([
    { id: 'L', sku: 'L', price: '189.00', selectedOptions: [{ name: 'Size', value: 'L' }] },
  ], ['L'], 19900);
  assert.equal(mispriced.ok, false);
});


test('draft pricing assertion checks line price and exact reservation credit independently of taxes', () => {
  const draftOrder = {
    totalLineItemsPriceSet: {
      shopMoney: { amount: '199.00', currencyCode: 'USD' },
    },
    totalDiscountsSet: {
      shopMoney: { amount: '24.99', currencyCode: 'USD' },
    },
    totalPriceSet: {
      shopMoney: { amount: '188.36', currencyCode: 'USD' },
    },
  };

  assert.equal(
    assertDraftOrderPricing(draftOrder, {
      expectedLineItemsCents: 19900,
      expectedDiscountCents: 2499,
      currencyCode: 'USD',
    }),
    true
  );

  const wrongDiscount = structuredClone(draftOrder);
  wrongDiscount.totalDiscountsSet.shopMoney.amount = '20.00';
  assert.throws(
    () => assertDraftOrderPricing(wrongDiscount, {
      expectedLineItemsCents: 19900,
      expectedDiscountCents: 2499,
      currencyCode: 'USD',
    }),
    /draft_order_discount_mismatch/
  );
});

test('standby draft pricing assertion requires zero discount', () => {
  assert.equal(
    assertDraftOrderPricing({
      totalLineItemsPriceSet: {
        shopMoney: { amount: '199.00', currencyCode: 'USD' },
      },
      totalDiscountsSet: {
        shopMoney: { amount: '0.00', currencyCode: 'USD' },
      },
    }, {
      expectedLineItemsCents: 19900,
      expectedDiscountCents: 0,
      currencyCode: 'USD',
    }),
    true
  );
});

test('Priority Reservation validation requires an order email for later collector delivery', () => {
  const fixture = priorityReservationFixture();
  delete fixture.order.email;
  fixture.order.customer = null;

  assert.throws(
    () => validatePriorityReservationOrder(fixture),
    /reservation_email_missing/
  );
});
