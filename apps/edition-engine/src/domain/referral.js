import { remainingIdentitySlots } from './rules.js';

export function validateReferral({
  referrerCustomerId,
  referredCustomerId,
  referredReservationPaid,
  alreadyRewarded,
  flagged,
}) {
  if (!referrerCustomerId || !referredCustomerId) {
    return { ok: false, reason: 'missing_customer' };
  }
  if (referrerCustomerId === referredCustomerId) {
    return { ok: false, reason: 'self_referral' };
  }
  if (!referredReservationPaid) {
    return { ok: false, reason: 'reservation_not_paid' };
  }
  if (alreadyRewarded) {
    return { ok: false, reason: 'already_rewarded' };
  }
  if (flagged) {
    return { ok: false, reason: 'review_required' };
  }
  return { ok: true };
}

export function canRewardIdentity(edition) {
  return remainingIdentitySlots(edition) > 0;
}
