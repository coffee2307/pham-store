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

  async claimReservationSlot(editionId) {
    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    if (edition.state !== CampaignState.RESERVATION_OPEN || edition.commerceReady !== true) {
      throw new Error('reservation_closed');
    }
    if (edition.reservationsClaimed >= edition.editionSize) {
      throw new Error('reservation_full');
    }

    edition.reservationsClaimed += 1;
    if (edition.reservationsClaimed >= edition.editionSize) {
      edition.state = CampaignState.RESERVATION_FULL;
    }
    return clone(edition);
  }

  async releaseReservationSlot(editionId) {
    const edition = this.editions.get(editionId);
    if (!edition) throw new Error('edition_not_found');
    edition.reservationsClaimed = Math.max(0, edition.reservationsClaimed - 1);
    return clone(edition);
  }

  async createReservation(input) {
    if (this.reservations.has(input.id)) throw new Error('reservation_exists');
    const customerKey = `${input.editionId}:${input.customerId}`;
    if (this.customerReservations.has(customerKey)) throw new Error('customer_already_reserved');

    const record = {
      ...clone(input),
      status: input.status || ReservationStatus.ACTIVE,
      createdAt: input.createdAt || new Date().toISOString(),
    };

    this.reservations.set(record.id, record);
    this.customerReservations.set(customerKey, record.id);
    return clone(record);
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

  async releaseObjectNumber({ editionId, reservationId }) {
    const number = this.reservationObject.get(reservationId);
    if (number == null) return null;
    this.reservationObject.delete(reservationId);
    this.objectClaims.delete(`${editionId}:${number}`);
    return number;
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

  async enqueueStandby(entry) {
    const queue = this.standby.get(entry.editionId) || [];
    if (queue.some((x) => x.customerId === entry.customerId && x.status !== 'expired')) {
      throw new Error('standby_already_joined');
    }

    const record = {
      ...clone(entry),
      status: 'waiting',
      joinedAt: entry.joinedAt || new Date().toISOString(),
      sequence: queue.length ? queue[queue.length - 1].sequence + 1 : 1,
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
