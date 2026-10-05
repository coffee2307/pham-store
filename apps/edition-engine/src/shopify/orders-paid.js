import { randomBytes } from 'node:crypto';

import { moneyToCents } from '../domain/rules.js';
import {
  extractReservationOrder,
  isPaidOrder,
  verifyShopifyWebhook,
} from './webhook.js';

function newReservationId(prefix = 'PHAM-R') {
  return `${prefix}-${randomBytes(6).toString('hex').toUpperCase()}`;
}

export async function handleOrdersPaidWebhook({
  rawBody,
  hmacHeader,
  webhookSecret,
  engine,
  store,
  edition,
  skus,
}) {
  if (!verifyShopifyWebhook(rawBody, hmacHeader, webhookSecret)) {
    return { status: 401, body: { ok: false, error: 'invalid_webhook_signature' } };
  }

  let order;
  try {
    order = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody));
  } catch {
    return { status: 400, body: { ok: false, error: 'invalid_json' } };
  }

  if (!isPaidOrder(order)) {
    return { status: 200, body: { ok: true, ignored: 'order_not_paid' } };
  }

  const mapped = extractReservationOrder(order, skus);
  if (!mapped) {
    return { status: 200, body: { ok: true, ignored: 'not_a_reservation_order' } };
  }

  if (!mapped.termsAccepted) {
    await store.recordEvent('reservation.review_required', {
      shopifyOrderId: mapped.shopifyOrderId,
      reason: 'missing_terms_evidence',
    });
    return { status: 202, body: { ok: false, review: 'missing_terms_evidence' } };
  }

  if (edition.includeLookbook && !mapped.lookbookIncluded) {
    await store.recordEvent('reservation.review_required', {
      shopifyOrderId: mapped.shopifyOrderId,
      reason: 'lookbook_entitlement_missing',
    });
    return { status: 202, body: { ok: false, review: 'lookbook_entitlement_missing' } };
  }

  const reservationId = newReservationId();
  let reservation;

  try {
    reservation = await engine.activateReservation({
      editionId: edition.id,
      reservationId,
      customerId: mapped.shopifyCustomerId,
      shopifyOrderId: mapped.shopifyOrderId,
      reservationPaidCents: moneyToCents(mapped.reservationAmount),
      referralCode: mapped.referralCode,
      paidAt: mapped.paidAt || new Date(),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'reservation_activation_failed';

    if (['reservation_exists', 'customer_already_reserved'].includes(reason)) {
      return { status: 200, body: { ok: true, duplicate: true } };
    }

    await store.recordEvent('reservation.activation_failed', {
      shopifyOrderId: mapped.shopifyOrderId,
      reason,
    });
    return { status: 409, body: { ok: false, error: reason } };
  }

  const result = {
    ok: true,
    reservationId: reservation.id,
    collectorReferralCode: reservation.collectorReferralCode,
    identity: null,
    referral: null,
    lookbook: edition.includeLookbook ? 'included' : 'not_included',
    review: [],
  };

  if (mapped.identitySelected) {
    try {
      result.identity = await engine.claimPaidIdentity({
        editionId: edition.id,
        reservationId: reservation.id,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'identity_claim_failed';
      result.review.push({
        type: 'paid_identity_remediation',
        reason,
        action: 'review_paid_addon_and_refund_or_remediate',
      });
      await store.recordEvent('identity.paid_claim_failed', {
        editionId: edition.id,
        reservationId: reservation.id,
        shopifyOrderId: mapped.shopifyOrderId,
        reason,
      });
    }
  }

  if (mapped.referralCode) {
    const referrer = await store.findReservationByCollectorReferralCode(
      edition.id,
      mapped.referralCode
    );

    if (!referrer) {
      result.referral = { verified: false, reason: 'referral_code_not_found' };
      await store.recordEvent('referral.unmatched', {
        editionId: edition.id,
        referredReservationId: reservation.id,
        referralCode: mapped.referralCode,
      });
    } else {
      try {
        const privilege = await engine.verifyReferral({
          editionId: edition.id,
          referrerReservationId: referrer.id,
          referredReservationId: reservation.id,
        });
        result.referral = {
          verified: true,
          referrerReservationId: referrer.id,
          identityStatus: privilege.status,
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'referral_verification_failed';
        result.referral = { verified: false, reason };
        await store.recordEvent('referral.verification_failed', {
          editionId: edition.id,
          referredReservationId: reservation.id,
          referrerReservationId: referrer.id,
          reason,
        });
      }
    }
  }

  await store.recordEvent('lookbook.entitlement_expected', {
    editionId: edition.id,
    reservationId: reservation.id,
    shopifyOrderId: mapped.shopifyOrderId,
    included: Boolean(mapped.lookbookIncluded),
  });

  return { status: result.review.length ? 202 : 200, body: result };
}
