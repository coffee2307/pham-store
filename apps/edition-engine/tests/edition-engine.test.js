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

test('self referral is rejected', async () => {
  const store = new InMemoryStore({ editions: [makeEdition()] });
  const engine = new EditionEngine(store);

  await engine.activateReservation({
    editionId: 'edition-01',
    reservationId: 'R-A',
    customerId: 'SAME',
    shopifyOrderId: 'O-A',
    reservationPaidCents: 2499,
  });
  await engine.activateReservation({
    editionId: 'edition-01',
    reservationId: 'R-B',
    customerId: 'SAME',
    shopifyOrderId: 'O-B',
    reservationPaidCents: 2499,
  }).catch(() => {});

  // Force the second reservation with another ID into the store to isolate referral validation.
  await store.createReservation({
    id: 'R-B',
    editionId: 'edition-01',
    customerId: 'SAME',
    shopifyOrderId: 'O-B',
    reservationPaidCents: 2499,
    status: ReservationStatus.ACTIVE,
  }).catch(() => {});

  await assert.rejects(
    () => engine.verifyReferral({
      editionId: 'edition-01',
      referrerReservationId: 'R-A',
      referredReservationId: 'R-B',
    }),
    /self_referral|reservation_not_found/
  );
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
