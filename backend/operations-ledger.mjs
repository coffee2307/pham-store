/**
 * Edition 01 production board. Consumes authenticated, private D1 rows only.
 * Never includes customer email, shipping addresses or payment account data.
 * Numbers without a reservation are UNASSIGNED, not necessarily for sale.
 */
export const PRODUCTION_STAGES = [
  'not_started', 'production_queued', 'in_production',
  'quality_control', 'packed', 'dispatched', 'delivered', 'archived'
];

function safeNumber(raw, max) {
  const number = Number(raw);
  return raw !== null && raw !== undefined && raw !== '' &&
    Number.isInteger(number) && number > 0 && number <= max ? number : null;
}

export function compileEditionOperations(edition, rows = []) {
  const capacity = Number(edition && (edition.edition_size ?? edition.editionSize));
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 500) {
    throw new Error('invalid_edition_capacity');
  }
  if (!Array.isArray(rows) || rows.length > capacity) {
    throw new Error('invalid_active_reservation_count');
  }

  const assigned = new Map();
  const seen = new Set();
  const stageCounts = Object.fromEntries(PRODUCTION_STAGES.map(stage => [stage, 0]));
  const sizeCounts = {};
  const concerns = {
    missingNumber: 0, missingSize: 0, unverifiedIdentity: 0,
    finalPaymentPending: 0, notShipped: 0, missingTracking: 0
  };
  let acquired = 0, delivered = 0, identityConfigured = 0;
  const reservations = [];

  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || seen.has(row.id)) {
      throw new Error('invalid_or_duplicate_reservation');
    }
    seen.add(row.id);
    const number = safeNumber(row.object_number, capacity);
    if (row.object_number !== null && row.object_number !== undefined &&
        row.object_number !== '' && number === null) {
      throw new Error('object_number_out_of_range');
    }
    if (number !== null && assigned.has(number)) {
      throw new Error('duplicate_object_number');
    }
    const size = String(row.size_preference || '').trim().toUpperCase();
    const stage = String(row.lifecycle_stage || 'not_started');
    if (!PRODUCTION_STAGES.includes(stage)) throw new Error('invalid_lifecycle_stage');

    const status = String(row.status || 'pending');
    const paid = status === 'final_paid';
    const identity = String(row.identity_status || 'locked');
    const hasIdentity = identity !== 'locked' && identity !== 'revoked';
    const contactVerified = Boolean(row.contact_verified_at);
    if (!size) concerns.missingSize += 1;
    if (number === null) concerns.missingNumber += 1;
    if (hasIdentity && (!contactVerified || identity !== 'configured')) {
      concerns.unverifiedIdentity += 1;
    }
    if (!paid) concerns.finalPaymentPending += 1;
    if (paid && !['dispatched', 'delivered', 'archived'].includes(stage)) {
      concerns.notShipped += 1;
    }
    if (['dispatched', 'delivered'].includes(stage) &&
        !row.tracking_number && !row.tracking_url) concerns.missingTracking += 1;
    if (paid) acquired += 1;
    if (['delivered','archived'].includes(stage)) delivered += 1;
    if (identity === 'configured' && contactVerified) identityConfigured += 1;
    stageCounts[stage] += 1;
    if (size) sizeCounts[size] = (sizeCounts[size] || 0) + 1;

    const item = {
      reservationId: row.id,
      objectNumber: number,
      size: size || null,
      reservationStatus: status,
      finalPaymentStatus: row.final_payment_status || null,
      lifecycleStage: stage,
      identityStatus: identity,
      identityContactVerified: contactVerified,
      printedName: contactVerified ? (row.engraving_name || null) : null,
      inscription: contactVerified ? (row.engraving_text || null) : null,
      specialInstructions: contactVerified ? (row.production_notes || null) : null,
      preferredNumber: safeNumber(row.preferred_number, capacity),
      cardStatus: hasIdentity
        ? contactVerified && identity === 'configured' ? 'confirmed' : 'awaiting_manual_confirmation'
        : 'not_requested',
      trackingNumber: row.tracking_number || null,
      trackingUrl: row.tracking_url || null,
      lookbookStatus: row.digital_lookbook_status || 'pending',
      paymentDeadline: row.payment_deadline || null
    };
    reservations.push(item);
    if (number !== null) assigned.set(number, item);
  }

  const slots = Array.from({length:capacity}, (_,i) => {
    const number = i+1;
    const row = assigned.get(number);
    return row ? {number, state:'assigned', reservationId:row.reservationId,
      size:row.size, lifecycleStage:row.lifecycleStage, cardStatus:row.cardStatus}
      : {number, state:'unassigned', reservationId:null,
         size:null, lifecycleStage:null, cardStatus:null};
  });
  return {
    editionId: edition.id,
    state: edition.state,
    capacity,
    counts: {
      reserved:rows.length, acquired, delivered,
      identityConfigured, unassignedSlots:capacity - assigned.size,
      awaitingObjectNumber:concerns.missingNumber
    },
    stageCounts, sizeCounts, concerns, slots, reservations,
    guidance: 'Unassigned numbers do not indicate available sale inventory. Check active reservations and Shopify stock before making promises.'
  };
}
