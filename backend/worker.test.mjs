import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeAppProxyParams } from './worker.js';

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
