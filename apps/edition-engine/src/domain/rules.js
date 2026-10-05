export const CampaignState = Object.freeze({
  PRELAUNCH: 'prelaunch',
  RESERVATION_OPEN: 'reservation_open',
  RESERVATION_FULL: 'reservation_full',
  FINAL_PAYMENT: 'final_payment',
  SOLD_OUT: 'sold_out',
  ARCHIVED: 'archived',
});

export const ReservationStatus = Object.freeze({
  ACTIVE: 'active',
  FINAL_PAYMENT_OPEN: 'final_payment_open',
  FINAL_PAID: 'final_paid',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
  FULFILLED: 'fulfilled',
  ARCHIVED: 'archived',
});

export const IdentityStatus = Object.freeze({
  LOCKED: 'locked',
  CLAIMED: 'claimed',
  CONFIGURED: 'configured',
  PRODUCTION_LOCKED: 'production_locked',
  FULFILLED: 'fulfilled',
});

export function moneyToCents(value) {
  const cents = Math.round(Number(value) * 100);
  if (!Number.isFinite(cents) || cents < 0) throw new Error('Invalid money value');
  return cents;
}

export function finalBalanceCents(finalPriceCents, reservationCreditCents) {
  const result = Number(finalPriceCents) - Number(reservationCreditCents);
  if (!Number.isInteger(result) || result < 0) throw new Error('Invalid final balance');
  return result;
}

export function canOpenReservation(edition) {
  return edition.state === CampaignState.RESERVATION_OPEN &&
    edition.commerceReady === true &&
    edition.reservationsClaimed < edition.editionSize;
}

export function remainingReservationSlots(edition) {
  return Math.max(0, edition.editionSize - edition.reservationsClaimed);
}

export function remainingIdentitySlots(edition) {
  return Math.max(0, edition.identityLimit - edition.identityClaimed);
}

export function paymentDeadline(openedAt, hours) {
  const start = openedAt instanceof Date ? openedAt : new Date(openedAt);
  if (Number.isNaN(start.getTime())) throw new Error('Invalid payment window start');
  if (!Number.isFinite(hours) || hours <= 0) throw new Error('Invalid payment window');
  return new Date(start.getTime() + hours * 60 * 60 * 1000);
}

export function isDeadlineExpired(deadline, now = new Date()) {
  return new Date(deadline).getTime() <= now.getTime();
}
