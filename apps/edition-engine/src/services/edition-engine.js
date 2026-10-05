import { generateReferralCode } from '../domain/referral-code.js';
import { validateReferral } from '../domain/referral.js';
import {
  ReservationStatus,
  isDeadlineExpired,
  paymentDeadline,
} from '../domain/rules.js';

export class EditionEngine {
  constructor(store) {
    this.store = store;
  }

  async activateReservation({
    editionId,
    reservationId,
    customerId,
    shopifyOrderId,
    reservationPaidCents,
    referralCode = '',
    paidAt = new Date(),
  }) {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const collectorReferralCode = generateReferralCode();

      try {
        const reservation = await this.store.createReservationWithSlot({
          id: reservationId,
          editionId,
          customerId,
          shopifyOrderId,
          reservationPaidCents,
          referralCode,
          paidAt: new Date(paidAt).toISOString(),
          status: ReservationStatus.ACTIVE,
          collectorReferralCode,
        });

        await this.store.recordEvent('reservation.paid', {
          editionId,
          reservationId,
          customerId,
          shopifyOrderId,
        });

        return reservation;
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';
        if (reason === 'referral_code_exists') continue;
        throw error;
      }
    }

    throw new Error('referral_code_generation_failed');
  }

  async claimPaidIdentity({ editionId, reservationId }) {
    const reservation = await this.requireActiveReservation(reservationId, editionId);
    const privilege = await this.store.claimIdentitySlot({
      editionId,
      reservationId: reservation.id,
      source: 'paid',
    });

    await this.store.recordEvent('identity.claimed.paid', {
      editionId,
      reservationId,
    });
    return privilege;
  }

  async verifyReferral({
    editionId,
    referrerReservationId,
    referredReservationId,
    flagged = false,
  }) {
    const referrer = await this.requireActiveReservation(referrerReservationId, editionId);
    const referred = await this.requireActiveReservation(referredReservationId, editionId);

    const existing = await this.store.getReferralConversion(referredReservationId);
    const validation = validateReferral({
      referrerCustomerId: referrer.customerId,
      referredCustomerId: referred.customerId,
      referredReservationPaid: true,
      alreadyRewarded: Boolean(existing),
      flagged,
    });
    if (!validation.ok) throw new Error(validation.reason);

    const result = await this.store.verifyReferralAndClaimIdentity({
      editionId,
      referrerReservationId,
      referredReservationId,
    });

    await this.store.recordEvent('referral.verified', {
      editionId,
      referrerReservationId,
      referredReservationId,
      identityNewlyClaimed: result.newlyClaimed,
    });

    return result.privilege;
  }

  async configureIdentity({
    editionId,
    reservationId,
    alias = '',
    inscription = '',
    preferredNumber,
    publicIdentity = false,
  }) {
    await this.requireActiveReservation(reservationId, editionId);
    const privilege = await this.store.getIdentityPrivilege(reservationId);
    if (!privilege) throw new Error('identity_not_claimed');

    const safeAlias = String(alias).trim().slice(0, 24);
    const safeInscription = String(inscription).trim().slice(0, 40);

    const configured = await this.store.configureIdentityWithObject({
      editionId,
      reservationId,
      number: Number(preferredNumber),
      configuration: {
        alias: safeAlias,
        inscription: safeInscription,
        publicIdentity: Boolean(publicIdentity),
      },
    });

    await this.store.recordEvent('identity.configured', {
      editionId,
      reservationId,
      objectNumber: configured.preferredNumber,
    });

    return configured;
  }

  async openFinalPayment({
    editionId,
    reservationId,
    openedAt = new Date(),
    windowHours = 72,
    balanceDueCents,
  }) {
    const reservation = await this.requireActiveReservation(reservationId, editionId);
    const deadline = paymentDeadline(openedAt, windowHours);

    const updated = await this.store.updateReservation(reservation.id, {
      status: ReservationStatus.FINAL_PAYMENT_OPEN,
      balanceDueCents,
      finalPaymentOpenedAt: new Date(openedAt).toISOString(),
      paymentDeadline: deadline.toISOString(),
    });

    await this.store.recordEvent('final_payment.opened', {
      editionId,
      reservationId,
      balanceDueCents,
      paymentDeadline: deadline.toISOString(),
    });

    return updated;
  }

  async markFinalPaid({ editionId, reservationId, paidAt = new Date() }) {
    const reservation = await this.store.getReservation(reservationId);
    if (!reservation || reservation.editionId !== editionId) throw new Error('reservation_not_found');
    if (reservation.status !== ReservationStatus.FINAL_PAYMENT_OPEN) {
      throw new Error('final_payment_not_open');
    }
    if (reservation.paymentDeadline && isDeadlineExpired(reservation.paymentDeadline, new Date(paidAt))) {
      throw new Error('payment_window_expired');
    }

    const updated = await this.store.updateReservation(reservationId, {
      status: ReservationStatus.FINAL_PAID,
      finalPaidAt: new Date(paidAt).toISOString(),
    });

    await this.store.recordEvent('final_payment.paid', { editionId, reservationId });
    return updated;
  }

  async expireReservation({
    editionId,
    reservationId,
    now = new Date(),
    standbyOfferHours = 48,
  }) {
    const reservation = await this.store.getReservation(reservationId);
    if (!reservation || reservation.editionId !== editionId) throw new Error('reservation_not_found');
    if (reservation.status !== ReservationStatus.FINAL_PAYMENT_OPEN) return { expired: false };
    if (!reservation.paymentDeadline || !isDeadlineExpired(reservation.paymentDeadline, now)) {
      return { expired: false };
    }

    await this.store.updateReservation(reservationId, {
      status: ReservationStatus.EXPIRED,
      expiredAt: new Date(now).toISOString(),
    });

    const releasedNumber = await this.store.releaseObjectNumber({ editionId, reservationId });
    await this.store.releaseReservationSlot(editionId);

    const offerDeadline = paymentDeadline(now, standbyOfferHours).toISOString();
    const promoted = await this.store.promoteNextStandby(editionId, { offerDeadline });

    await this.store.recordEvent('reservation.expired', {
      editionId,
      reservationId,
      releasedNumber,
      promotedCustomerId: promoted?.customerId || null,
    });

    return { expired: true, releasedNumber, promoted };
  }

  async joinStandby({ editionId, customerId, email, country = '', size = '' }) {
    const edition = await this.store.getEdition(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (edition.reservationsClaimed < edition.editionSize) throw new Error('standby_not_open');

    const entry = await this.store.enqueueStandby({
      editionId,
      customerId,
      email,
      country,
      size,
    });

    await this.store.recordEvent('standby.joined', {
      editionId,
      customerId,
      sequence: entry.sequence,
    });

    return entry;
  }

  async requireActiveReservation(reservationId, editionId) {
    const reservation = await this.store.getReservation(reservationId);
    if (!reservation || reservation.editionId !== editionId) throw new Error('reservation_not_found');

    const allowed = new Set([
      ReservationStatus.ACTIVE,
      ReservationStatus.FINAL_PAYMENT_OPEN,
      ReservationStatus.FINAL_PAID,
    ]);
    if (!allowed.has(reservation.status)) throw new Error('reservation_inactive');
    return reservation;
  }
}
