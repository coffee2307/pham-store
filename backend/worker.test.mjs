import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFinalAcquisitionDraftInput,
  canonicalizeAppProxyParams,
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
