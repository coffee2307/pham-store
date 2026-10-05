import { createHmac, timingSafeEqual } from 'node:crypto';

function safeBuffer(value) {
  return Buffer.from(String(value || ''), 'utf8');
}

export function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;

  const digest = createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const expected = safeBuffer(digest);
  const provided = safeBuffer(hmacHeader);

  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}

export function normalizeShopifyCustomerId(customer) {
  if (!customer) return '';
  if (customer.id != null && String(customer.id).trim() !== '') {
    return String(customer.id);
  }

  const gid = String(customer.admin_graphql_api_id || '').trim();
  const match = gid.match(/\/Customer\/(\d+)$/);
  return match ? match[1] : gid;
}

function propertyMap(properties = []) {
  const out = {};
  for (const property of properties || []) {
    if (!property || !property.name) continue;
    out[property.name] = property.value ?? '';
  }
  return out;
}

export function extractReservationOrder(order, {
  reservationSku,
  identitySku,
  lookbookSku,
} = {}) {
  if (!order || !Array.isArray(order.line_items)) {
    throw new Error('invalid_order_payload');
  }

  const lineItems = order.line_items;
  const reservationLine = lineItems.find((item) => item.sku === reservationSku);
  if (!reservationLine) return null;

  const identityLine = identitySku
    ? lineItems.find((item) => item.sku === identitySku)
    : null;
  const lookbookLine = lookbookSku
    ? lineItems.find((item) => item.sku === lookbookSku)
    : null;

  const props = propertyMap(reservationLine.properties);

  return {
    shopifyOrderId: String(order.admin_graphql_api_id || order.id || ''),
    shopifyCustomerId: normalizeShopifyCustomerId(order.customer),
    email: order.email || order.customer?.email || '',
    financialStatus: order.financial_status || '',
    currency: order.currency || '',
    reservationAmount: String(reservationLine.price || ''),
    editionLabel: props['_PHAM Edition'] || '',
    productCode: props['_PHAM Product'] || '',
    referralCode: props['_PHAM Referral Code'] || '',
    termsAccepted: props['Reservation terms'] === 'Accepted',
    digitalLookbookRequested: props['Digital lookbook delivery'] === 'Included',
    identitySelected: Boolean(identityLine),
    lookbookIncluded: Boolean(lookbookLine),
    paidAt: order.processed_at || order.created_at || null,
  };
}

export function isPaidOrder(order) {
  return ['paid', 'partially_paid'].includes(String(order?.financial_status || '').toLowerCase());
}
