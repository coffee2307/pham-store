import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { InMemoryStore } from '../src/adapters/in-memory-store.js';
import { EditionEngine } from '../src/services/edition-engine.js';
import { CampaignState } from '../src/domain/rules.js';
import { handleCollectorProxyRequest } from '../src/http/app-proxy-handler.js';

function signedProxyUrl({
  secret,
  customerId = '',
  timestamp = 1000,
  extras = {},
}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(extras)) {
    params.append(key, String(value));
  }
  params.append('shop', 'test.myshopify.com');
  params.append('logged_in_customer_id', customerId);
  params.append('path_prefix', '/apps/pham-edition');
  params.append('timestamp', String(timestamp));

  const grouped = new Map();
  for (const [key, value] of params.entries()) {
    const values = grouped.get(key) || [];
    values.push(value);
    grouped.set(key, values);
  }
  const canonical = Array.from(grouped.entries())
    .map(([key, values]) => `${key}=${values.join(',')}`)
    .sort()
    .join('');

  const signature = createHmac('sha256', secret).update(canonical).digest('hex');
  params.append('signature', signature);

  return new URL(`https://example.com/proxy?${params.toString()}`);
}

function edition(overrides = {}) {
  return {
    id: 'edition-01',
    label: 'EDITION 01',
    productCode: 'PHAM-001',
    state: CampaignState.RESERVATION_OPEN,
    commerceReady: true,
    editionSize: 50,
    reservationsClaimed: 0,
    identityLimit: 15,
    identityClaimed: 0,
    ...overrides,
  };
}

test('collector status resolves only through signed logged-in customer identity', async () => {
  const record = edition();
  const store = new InMemoryStore({ editions: [record] });
  const engine = new EditionEngine(store);
  const reservation = await engine.activateReservation({
    editionId: record.id,
    reservationId: 'R-1',
    customerId: '101',
    shopifyOrderId: 'O-1',
    reservationPaidCents: 2499,
  });

  const secret = 'proxy-secret';
  const url = signedProxyUrl({ secret, customerId: '101' });

  const response = await handleCollectorProxyRequest({
    url,
    method: 'GET',
    route: '/status',
    secret,
    engine,
    store,
    edition: record,
    nowSeconds: 1000,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.reservation.id, reservation.id);
  assert.equal(response.body.identity.status, 'locked');

  const anonymous = signedProxyUrl({ secret, customerId: '' });
  const denied = await handleCollectorProxyRequest({
    url: anonymous,
    method: 'GET',
    route: '/status',
    secret,
    engine,
    store,
    edition: record,
    nowSeconds: 1000,
  });

  assert.equal(denied.status, 401);
});

test('Identity configuration requires a claimed privilege and locks object number', async () => {
  const record = edition();
  const store = new InMemoryStore({ editions: [record] });
  const engine = new EditionEngine(store);

  await engine.activateReservation({
    editionId: record.id,
    reservationId: 'R-1',
    customerId: '101',
    shopifyOrderId: 'O-1',
    reservationPaidCents: 2499,
  });
  await engine.claimPaidIdentity({ editionId: record.id, reservationId: 'R-1' });

  const secret = 'proxy-secret';
  const url = signedProxyUrl({ secret, customerId: '101' });

  const response = await handleCollectorProxyRequest({
    url,
    method: 'POST',
    route: '/identity/configure',
    body: {
      alias: 'COFFEE',
      inscription: 'BUILT WITHOUT COMPROMISE',
      preferredNumber: 7,
      publicIdentity: true,
    },
    secret,
    engine,
    store,
    edition: record,
    nowSeconds: 1000,
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.identity.preferredNumber, 7);
  assert.equal(response.body.identity.alias, 'COFFEE');
});

test('anonymous signed App Proxy request can join standby by email once edition is full', async () => {
  const record = edition({
    state: CampaignState.RESERVATION_FULL,
    editionSize: 1,
    reservationsClaimed: 1,
  });
  const store = new InMemoryStore({ editions: [record] });
  const engine = new EditionEngine(store);

  const secret = 'proxy-secret';
  const url = signedProxyUrl({ secret, customerId: '' });

  const first = await handleCollectorProxyRequest({
    url,
    method: 'POST',
    route: '/standby/join',
    body: {
      email: 'first@example.com',
      country: 'VN',
      size: 'M',
    },
    secret,
    engine,
    store,
    edition: record,
    nowSeconds: 1000,
  });

  const second = await handleCollectorProxyRequest({
    url,
    method: 'POST',
    route: '/standby/join',
    body: {
      email: 'second@example.com',
      country: 'VN',
      size: 'L',
    },
    secret,
    engine,
    store,
    edition: record,
    nowSeconds: 1000,
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.standby.sequence, 1);
  assert.equal(second.body.standby.sequence, 2);
});
