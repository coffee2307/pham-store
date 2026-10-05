import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  canonicalizeAppProxyParams,
  verifyAppProxyRequest,
} from '../src/shopify/app-proxy.js';

test('canonicalizes Shopify App Proxy params with repeated values', () => {
  const url = new URL('https://example.com/proxy?extra=1&extra=2&shop=test.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fpham&timestamp=1317327555&signature=ignore');
  assert.equal(
    canonicalizeAppProxyParams(url.searchParams),
    'extra=1,2logged_in_customer_id=1path_prefix=/apps/phamshop=test.myshopify.comtimestamp=1317327555'
  );
});

test('verifies Shopify App Proxy signature and customer identity payload', () => {
  const secret = 'hush';
  const url = new URL('https://example.com/proxy?extra=1&extra=2&shop=test.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fawesome_reviews&timestamp=1317327555');
  const canonical = canonicalizeAppProxyParams(url.searchParams);
  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  url.searchParams.set('signature', signature);

  const result = verifyAppProxyRequest(url, secret, {
    nowSeconds: 1317327555,
    maxAgeSeconds: 300,
  });

  assert.equal(result.ok, true);
  assert.equal(result.customerId, '1');
  assert.equal(result.pathPrefix, '/apps/awesome_reviews');
});

test('rejects stale or tampered App Proxy requests', () => {
  const stale = new URL('https://example.com/proxy?shop=test.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fpham&timestamp=100&signature=bad');
  const result = verifyAppProxyRequest(stale, 'secret', {
    nowSeconds: 1000,
    maxAgeSeconds: 300,
  });

  assert.equal(result.ok, false);
});

test('rejects repeated App Proxy security parameters', () => {
  const secret = 'hush';
  const url = new URL('https://example.com/proxy?shop=test.myshopify.com&shop=evil.myshopify.com&logged_in_customer_id=1&path_prefix=%2Fapps%2Fpham&timestamp=1000');
  const canonical = canonicalizeAppProxyParams(url.searchParams);
  url.searchParams.set('signature', createHmac('sha256', secret).update(canonical).digest('hex'));

  const result = verifyAppProxyRequest(url, secret, {
    nowSeconds: 1000,
    maxAgeSeconds: 300,
  });

  assert.deepEqual(result, { ok: false, reason: 'duplicate_security_parameter' });
});
