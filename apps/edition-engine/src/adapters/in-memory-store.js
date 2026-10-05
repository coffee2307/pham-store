import {
  CampaignState,
  IdentityStatus,
  ReservationStatus,
} from '../domain/rules.js';

function clone(value) {
  return value == null ? value : structuredClone(value);
}

export class InMemoryStore {
  constructor({ editions = [] } = {}) {
    this.editions = new Map(editions.map((edition) => [edition.id, clone(edition)]));
    this.reservations = new Map();
    this.customerReservations = new Map();
    this.identityPrivileges = new Map();
    this.objectClaims = new Map();
    this.reservationObject = new Map();
    this.referralConversions = new Map();
    this.standby = new Map();
    this.events = [];
  }

  async getEdition(id) {
    return clone(this.editions.get(id) || null);
  }

  async createReservationWithSlot(input) {
    if (this.reservations.has(input.id)) throw new Error('reservation_exists');

    const customerKey = `${input.editionId}:${input.customerId}`;
    if (this.customerReservations.has(customerKey)) {
      throw new Error('customer_already_reserved');
    }

    for (const reservation of this.reservations.values()) {
      if (
        reservation.editionId === input.editionId &&
        reservation.shopifyOrderId === input.shopifyOrderId
      ) {
        throw new Error('order_already_reserved');
      }
      if (
        reservation.editionId === input.editionId &&
        reservation.collectorReferralCode === input.collectorReferralCode
      ) {
        throw new Error('referral_code_exists');
      }
    }

    const edition = this.editions.get(input.editionId);
    if (!edition) throw new Error('edition_not_found');
    if (edition.state !== CampaignState.RESERVATION_OPEN || edition.commerceReady !== true) {
      throw new Error('reservation_closed');
    }
    if (edition.reservationsClaimed >= edition.editionSize) {
      throw new Error('reservation_full');
    }

    const record = {
      acquisitionType: 'priority_reservation',
      lookbookStatus: 'pending',
      ...clone(input),
      status: input.status || ReservationStatus.ACTIVE,
      createdAt: input.createdAt || new Date().toISOString(),
    };

    edition.reservationsClaimed += 1;
    if (edition.reservationsClaimed >= edition.editionSize) {
      edition.state = CampaignState.RESERVATION_FULL;
    }

    this.reservations.set(record.id, record);
    this.customerReservations.set(customerKey, record.id);
    return clone(record);
  }

  async releaseReservationSlot(editionId) {
    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    edition.reservationsClaimed = Math.max(0, edition.reservationsClaimed - 1);
    return clone(edition);
  }

  async getReservation(id) {
    return clone(this.reservations.get(id) || null);
  }

  async findReservationByCollectorReferralCode(editionId, code) {
    for (const reservation of this.reservations.values()) {
      if (
        reservation.editionId === editionId &&
        reservation.collectorReferralCode === code
      ) {
        return clone(reservation);
      }
    }
    return null;
  }

  async findReservationByCustomer(editionId, customerId) {
    const reservationId = this.customerReservations.get(`${editionId}:${customerId}`);
    return reservationId ? clone(this.reservations.get(reservationId) || null) : null;
  }

  async updateReservation(id, patch) {
    const current = this.reservations.get(id);
    if (!current) throw new Error('reservation_not_found');
    Object.assign(current, clone(patch), { updatedAt: new Date().toISOString() });
    return clone(current);
  }

  async claimIdentitySlot({ editionId, reservationId, source }) {
    if (this.identityPrivileges.has(reservationId)) {
      return clone(this.identityPrivileges.get(reservationId));
    }

    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (edition.identityClaimed >= edition.identityLimit) throw new Error('identity_full');

    edition.identityClaimed += 1;
    const privilege = {
      reservationId,
      editionId,
      source,
      status: IdentityStatus.CLAIMED,
      claimedAt: new Date().toISOString(),
    };
    this.identityPrivileges.set(reservationId, privilege);
    return clone(privilege);
  }

  async getIdentityPrivilege(reservationId) {
    return clone(this.identityPrivileges.get(reservationId) || null);
  }

  async configureIdentity(reservationId, configuration) {
    const privilege = this.identityPrivileges.get(reservationId);
    if (!privilege) throw new Error('identity_not_claimed');
    Object.assign(privilege, clone(configuration), {
      status: IdentityStatus.CONFIGURED,
      configuredAt: new Date().toISOString(),
    });
    return clone(privilege);
  }

  async configureIdentityWithObject({
    editionId,
    reservationId,
    number,
    configuration,
  }) {
    const privilege = this.identityPrivileges.get(reservationId);
    if (!privilege) throw new Error('identity_not_claimed');

    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (!Number.isInteger(number) || number < 1 || number > edition.editionSize) {
      throw new Error('object_number_out_of_range');
    }

    const currentForReservation = this.reservationObject.get(reservationId);
    if (currentForReservation != null && currentForReservation !== number) {
      throw new Error('reservation_already_has_object');
    }

    const key = `${editionId}:${number}`;
    const currentOwner = this.objectClaims.get(key);
    if (currentOwner && currentOwner !== reservationId) {
      throw new Error('object_number_taken');
    }

    this.objectClaims.set(key, reservationId);
    this.reservationObject.set(reservationId, number);

    Object.assign(privilege, clone(configuration), {
      preferredNumber: number,
      status: IdentityStatus.CONFIGURED,
      configuredAt: new Date().toISOString(),
    });

    return clone(privilege);
  }

  async claimObjectNumber({ editionId, reservationId, number }) {
    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (!Number.isInteger(number) || number < 1 || number > edition.editionSize) {
      throw new Error('object_number_out_of_range');
    }

    const currentForReservation = this.reservationObject.get(reservationId);
    if (currentForReservation === number) {
      return { editionId, reservationId, number };
    }
    if (currentForReservation != null) throw new Error('reservation_already_has_object');

    const key = `${editionId}:${number}`;
    if (this.objectClaims.has(key)) throw new Error('object_number_taken');

    this.objectClaims.set(key, reservationId);
    this.reservationObject.set(reservationId, number);
    return { editionId, reservationId, number };
  }

  async getObjectNumberByReservation(reservationId) {
    return this.reservationObject.get(reservationId) ?? null;
  }

  async releaseObjectNumber({ editionId, reservationId }) {
    const number = this.reservationObject.get(reservationId);
    if (number == null) return null;
    this.reservationObject.delete(reservationId);
    this.objectClaims.delete(`${editionId}:${number}`);
    return number;
  }

  async verifyReferralAndClaimIdentity({
    editionId,
    referrerReservationId,
    referredReservationId,
  }) {
    if (this.referralConversions.has(referredReservationId)) {
      throw new Error('referral_already_attributed');
    }

    let privilege = this.identityPrivileges.get(referrerReservationId) || null;
    let newlyClaimed = false;

    if (!privilege) {
      const edition = this.editions.get(editionId);
      if (!edition) throw new Error('edition_not_found');
      if (edition.identityClaimed >= edition.identityLimit) {
        throw new Error('identity_full');
      }

      privilege = {
        reservationId: referrerReservationId,
        editionId,
        source: 'referral',
        status: IdentityStatus.CLAIMED,
        claimedAt: new Date().toISOString(),
      };
      newlyClaimed = true;
    }

    const conversion = {
      referredReservationId,
      referrerReservationId,
      verifiedAt: new Date().toISOString(),
      status: 'verified',
    };

    if (newlyClaimed) {
      const edition = this.editions.get(editionId);
      edition.identityClaimed += 1;
      this.identityPrivileges.set(referrerReservationId, privilege);
    }

    this.referralConversions.set(referredReservationId, conversion);

    return {
      privilege: clone(privilege),
      conversion: clone(conversion),
      newlyClaimed,
    };
  }

  async markReferralConversion({
    referredReservationId,
    referrerReservationId,
    verifiedAt = new Date().toISOString(),
  }) {
    if (this.referralConversions.has(referredReservationId)) {
      throw new Error('referral_already_attributed');
    }
    const record = { referredReservationId, referrerReservationId, verifiedAt };
    this.referralConversions.set(referredReservationId, record);
    return clone(record);
  }

  async getReferralConversion(referredReservationId) {
    return clone(this.referralConversions.get(referredReservationId) || null);
  }

  async countVerifiedReferrals(referrerReservationId) {
    let count = 0;
    for (const conversion of this.referralConversions.values()) {
      if (
        conversion.referrerReservationId === referrerReservationId &&
        conversion.status !== 'revoked'
      ) {
        count += 1;
      }
    }
    return count;
  }

  async expireReservationAndPromote({
    editionId,
    reservationId,
    now,
    standbyOfferDeadline,
  }) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.editionId !== editionId) {
      throw new Error('reservation_not_found');
    }

    if (reservation.status !== ReservationStatus.FINAL_PAYMENT_OPEN) {
      return { expired: false, releasedNumber: null, promoted: null };
    }

    if (!reservation.paymentDeadline || new Date(reservation.paymentDeadline).getTime() > new Date(now).getTime()) {
      return { expired: false, releasedNumber: null, promoted: null };
    }

    const releasedNumber = this.reservationObject.get(reservationId) ?? null;
    const queue = this.standby.get(editionId) || [];
    const next = queue.find((entry) => entry.status === 'waiting') || null;

    reservation.status = ReservationStatus.EXPIRED;
    reservation.expiredAt = new Date(now).toISOString();
    reservation.updatedAt = new Date().toISOString();

    if (releasedNumber != null) {
      this.reservationObject.delete(reservationId);
      this.objectClaims.delete(`${editionId}:${releasedNumber}`);
    }

    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    edition.reservationsClaimed = Math.max(0, edition.reservationsClaimed - 1);

    let promoted = null;
    if (next) {
      next.status = 'offered';
      next.promotedAt = new Date(now).toISOString();
      next.offerDeadline = standbyOfferDeadline;
      promoted = clone(next);
    }

    return { expired: true, releasedNumber, promoted };
  }

  async enqueueStandby(entry) {
    const queue = this.standby.get(entry.editionId) || [];
    if (queue.some((x) => x.customerId === entry.customerId && x.status !== 'expired')) {
      throw new Error('standby_already_joined');
    }

    const sequence = queue.length ? queue[queue.length - 1].sequence + 1 : 1;
    const record = {
      ...clone(entry),
      id: entry.id || `STANDBY-${entry.editionId}-${sequence}`,
      status: 'waiting',
      joinedAt: entry.joinedAt || new Date().toISOString(),
      sequence,
    };

    queue.push(record);
    this.standby.set(entry.editionId, queue);
    return clone(record);
  }

  async promoteNextStandby(editionId, { offerDeadline }) {
    const queue = this.standby.get(editionId) || [];
    const next = queue.find((entry) => entry.status === 'waiting');
    if (!next) return null;

    next.status = 'offered';
    next.promotedAt = new Date().toISOString();
    next.offerDeadline = offerDeadline;
    return clone(next);
  }

  async markFinalPaidAtomic({
    editionId,
    reservationId,
    shopifyOrderId,
    paidAt,
  }) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.editionId !== editionId) {
      throw new Error('reservation_not_found');
    }

    if (reservation.status === ReservationStatus.FINAL_PAID) {
      if (
        !reservation.finalPaymentShopifyOrderId ||
        reservation.finalPaymentShopifyOrderId === shopifyOrderId
      ) {
        return clone(reservation);
      }
      throw new Error('final_payment_already_recorded');
    }

    if (reservation.status !== ReservationStatus.FINAL_PAYMENT_OPEN) {
      throw new Error('final_payment_not_open');
    }

    if (
      reservation.paymentDeadline &&
      new Date(reservation.paymentDeadline).getTime() < new Date(paidAt).getTime()
    ) {
      throw new Error('payment_window_expired');
    }

    for (const existing of this.reservations.values()) {
      if (
        existing.id !== reservationId &&
        existing.finalPaymentShopifyOrderId === shopifyOrderId
      ) {
        throw new Error('final_order_already_used');
      }
    }

    reservation.status = ReservationStatus.FINAL_PAID;
    reservation.finalPaidAt = new Date(paidAt).toISOString();
    reservation.finalPaymentShopifyOrderId = shopifyOrderId;
    reservation.updatedAt = new Date().toISOString();
    return clone(reservation);
  }

  async getStandbyEntryById(editionId, standbyEntryId) {
    const queue = this.standby.get(editionId) || [];
    const entry = queue.find((item) => String(item.id) === String(standbyEntryId));
    return clone(entry || null);
  }

  async convertStandbyToReservation({
    editionId,
    standbyEntryId,
    reservationId,
    customerId,
    shopifyOrderId,
    finalPriceCents,
    collectorReferralCode,
    paidAt,
  }) {
    const queue = this.standby.get(editionId) || [];
    const entry = queue.find((item) => String(item.id) === String(standbyEntryId));
    if (!entry) throw new Error('standby_entry_not_found');

    if (entry.status === 'converted') {
      const existing = Array.from(this.reservations.values()).find(
        (item) => item.shopifyOrderId === shopifyOrderId
      );
      if (existing) return clone(existing);
      throw new Error('standby_already_converted');
    }

    if (entry.status !== 'offered') throw new Error('standby_offer_not_active');
    if (
      entry.offerDeadline &&
      new Date(entry.offerDeadline).getTime() < new Date(paidAt).getTime()
    ) {
      throw new Error('standby_offer_expired');
    }

    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (edition.reservationsClaimed >= edition.editionSize) {
      throw new Error('edition_full');
    }

    const customerKey = `${editionId}:${customerId}`;
    if (this.customerReservations.has(customerKey)) {
      throw new Error('customer_already_reserved');
    }

    for (const existing of this.reservations.values()) {
      if (existing.shopifyOrderId === shopifyOrderId) return clone(existing);
      if (existing.collectorReferralCode === collectorReferralCode) {
        throw new Error('referral_code_exists');
      }
    }

    const reservation = {
      id: reservationId,
      editionId,
      customerId,
      shopifyOrderId,
      status: ReservationStatus.FINAL_PAID,
      acquisitionType: 'standby',
      reservationPaidCents: 0,
      balanceDueCents: finalPriceCents,
      collectorReferralCode,
      referralCode: '',
      paidAt: new Date(paidAt).toISOString(),
      finalPaidAt: new Date(paidAt).toISOString(),
      finalPaymentShopifyOrderId: shopifyOrderId,
      lookbookStatus: 'not_included',
      createdAt: new Date().toISOString(),
    };

    this.reservations.set(reservationId, reservation);
    this.customerReservations.set(customerKey, reservationId);

    edition.reservationsClaimed += 1;
    entry.status = 'converted';
    entry.convertedOrderId = shopifyOrderId;
    entry.convertedAt = new Date(paidAt).toISOString();

    return clone(reservation);
  }

  async recordEvent(type, payload) {
    const event = {
      id: this.events.length + 1,
      type,
      payload: clone(payload),
      createdAt: new Date().toISOString(),
    };
    this.events.push(event);
    return clone(event);
  }
}
