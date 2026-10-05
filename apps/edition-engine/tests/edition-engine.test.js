import test from 'node:test';
import assert from 'node:assert/strict';

import { InMemoryStore } from '../src/adapters/in-memory-store.js';
import { EditionEngine } from '../src/services/edition-engine.js';
import {
  CampaignState,
  ReservationStatus,
} from '../src/domain/rules.js';

function makeEdition(overrides = {}) {
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

async function reserve(engine, n, extra = {}) {
  return engine.activateReservation({
    editionId: 'edition-01',
    reservationId: `R-${n}`,
    customerId: `C-${n}`,
    shopifyOrderId: `O-${n}`,
    reservationPaidCents: 2499,
    ...extra,
  });
}

test('reservation allocation cannot exceed edition size', async () => {
  const store = new InMemoryStore({ editions: [makeEdition({ editionSize: 2 })] });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);
  await reserve(engine, 2);

  const edition = await store.getEdition('edition-01');
  assert.equal(edition.reservationsClaimed, 2);
  assert.equal(edition.state, CampaignState.RESERVATION_FULL);

  await assert.rejects(() => reserve(engine, 3), /reservation_closed|reservation_full/);
});

test('self referral is rejected by referral rules', async () => {
  const { validateReferral } = await import('../src/domain/referral.js');

  const result = validateReferral({
    referrerCustomerId: 'SAME',
    referredCustomerId: 'SAME',
    referredReservationPaid: true,
    alreadyRewarded: false,
    flagged: false,
  });

  assert.deepEqual(result, { ok: false, reason: 'self_referral' });
});

test('paid and referral identity claims share one edition-wide pool', async () => {
  const store = new InMemoryStore({
    editions: [makeEdition({ identityLimit: 1 })],
  });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);
  await reserve(engine, 2);

  await engine.claimPaidIdentity({ editionId: 'edition-01', reservationId: 'R-1' });

  await assert.rejects(
    () => engine.verifyReferral({
      editionId: 'edition-01',
      referrerReservationId: 'R-2',
      referredReservationId: 'R-1',
    }),
    /identity_full/
  );

  const edition = await store.getEdition('edition-01');
  assert.equal(edition.identityClaimed, 1);
});

test('one object number cannot be claimed by two collectors', async () => {
  const store = new InMemoryStore({ editions: [makeEdition()] });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);
  await reserve(engine, 2);
  await engine.claimPaidIdentity({ editionId: 'edition-01', reservationId: 'R-1' });
  await engine.claimPaidIdentity({ editionId: 'edition-01', reservationId: 'R-2' });

  await engine.configureIdentity({
    editionId: 'edition-01',
    reservationId: 'R-1',
    alias: 'ONE',
    inscription: 'FIRST',
    preferredNumber: 7,
  });

  await assert.rejects(
    () => engine.configureIdentity({
      editionId: 'edition-01',
      reservationId: 'R-2',
      alias: 'TWO',
      inscription: 'SECOND',
      preferredNumber: 7,
    }),
    /object_number_taken/
  );
});

test('final payment cannot be completed after deadline', async () => {
  const store = new InMemoryStore({ editions: [makeEdition()] });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);

  const openedAt = new Date('2026-10-05T00:00:00.000Z');
  await engine.openFinalPayment({
    editionId: 'edition-01',
    reservationId: 'R-1',
    openedAt,
    windowHours: 72,
    balanceDueCents: 17401,
  });

  await assert.rejects(
    () => engine.markFinalPaid({
      editionId: 'edition-01',
      reservationId: 'R-1',
      shopifyOrderId: 'FINAL-O-1',
      paidAt: new Date('2026-10-08T00:00:01.000Z'),
    }),
    /payment_window_expired/
  );
});

test('expired reservation releases object and promotes FIFO standby', async () => {
  const store = new InMemoryStore({
    editions: [makeEdition({ editionSize: 1 })],
  });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);
  await engine.claimPaidIdentity({ editionId: 'edition-01', reservationId: 'R-1' });
  await engine.configureIdentity({
    editionId: 'edition-01',
    reservationId: 'R-1',
    preferredNumber: 1,
  });

  await engine.joinStandby({
    editionId: 'edition-01',
    customerId: 'STANDBY-1',
    email: 'first@example.com',
  });
  await engine.joinStandby({
    editionId: 'edition-01',
    customerId: 'STANDBY-2',
    email: 'second@example.com',
  });

  await engine.openFinalPayment({
    editionId: 'edition-01',
    reservationId: 'R-1',
    openedAt: new Date('2026-10-01T00:00:00.000Z'),
    windowHours: 72,
    balanceDueCents: 17401,
  });

  const result = await engine.expireReservation({
    editionId: 'edition-01',
    reservationId: 'R-1',
    now: new Date('2026-10-05T00:00:00.000Z'),
    standbyOfferHours: 48,
  });

  assert.equal(result.expired, true);
  assert.equal(result.releasedNumber, 1);
  assert.equal(result.promoted.customerId, 'STANDBY-1');

  const reservation = await store.getReservation('R-1');
  assert.equal(reservation.status, ReservationStatus.EXPIRED);
});


test('final payment is idempotent for the same Shopify order', async () => {
  const store = new InMemoryStore({ editions: [makeEdition()] });
  const engine = new EditionEngine(store);

  await reserve(engine, 1);
  await engine.openFinalPayment({
    editionId: 'edition-01',
    reservationId: 'R-1',
    openedAt: new Date('2026-10-05T00:00:00.000Z'),
    windowHours: 72,
    balanceDueCents: 17401,
  });

  const args = {
    editionId: 'edition-01',
    reservationId: 'R-1',
    shopifyOrderId: 'FINAL-O-1',
    paidAt: new Date('2026-10-06T00:00:00.000Z'),
  };

  const first = await engine.markFinalPaid(args);
  const second = await engine.markFinalPaid(args);

  assert.equal(first.status, ReservationStatus.FINAL_PAID);
  assert.equal(second.status, ReservationStatus.FINAL_PAID);
  assert.equal(second.finalPaymentShopifyOrderId, 'FINAL-O-1');
});

test('standby full-price payment converts offered entry into final-paid collector', async () => {
  const store = new InMemoryStore({
    editions: [makeEdition({
      editionSize: 1,
      reservationsClaimed: 1,
      state: CampaignState.RESERVATION_FULL,
    })],
  });
  const engine = new EditionEngine(store);

  const entry = await engine.joinStandby({
    editionId: 'edition-01',
    customerId: 'STANDBY-1',
    email: 'standby@example.com',
  });

  const queue = store.standby.get('edition-01');
  queue[0].status = 'offered';
  queue[0].offerDeadline = '2026-10-10T00:00:00.000Z';

  // A released priority slot makes room for the promoted standby collector.
  store.editions.get('edition-01').reservationsClaimed = 0;

  const converted = await engine.convertStandbyPayment({
    editionId: 'edition-01',
    standbyEntryId: entry.id,
    customerId: 'gid://shopify/Customer/99',
    shopifyOrderId: 'gid://shopify/Order/99',
    finalPriceCents: 19900,
    paidAt: new Date('2026-10-09T00:00:00.000Z'),
  });

  assert.equal(converted.status, ReservationStatus.FINAL_PAID);
  assert.equal(converted.acquisitionType, 'standby');
  assert.equal(converted.reservationPaidCents, 0);
  assert.equal(converted.balanceDueCents, 19900);
  assert.equal(converted.lookbookStatus, 'not_included');

  const edition = await store.getEdition('edition-01');
  assert.equal(edition.reservationsClaimed, 1);
  assert.equal(queue[0].status, 'converted');
  assert.equal(queue[0].convertedOrderId, 'gid://shopify/Order/99');
});
