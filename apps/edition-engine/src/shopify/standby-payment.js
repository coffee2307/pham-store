import { CREATE_FINAL_PAYMENT_DRAFT_ORDER, SEND_FINAL_PAYMENT_INVOICE } from './final-payment.js';

export const CREATE_STANDBY_DRAFT_ORDER = CREATE_FINAL_PAYMENT_DRAFT_ORDER;
export const SEND_STANDBY_INVOICE = SEND_FINAL_PAYMENT_INVOICE;

export function buildStandbyDraftOrderInput({
  customerId,
  email,
  productVariantId,
  standbyEntryId,
  editionLabel,
  productCode,
  offerDeadline,
}) {
  if (!productVariantId) throw new Error('missing_product_variant');
  if (!standbyEntryId) throw new Error('missing_standby_entry_id');
  if (!offerDeadline) throw new Error('missing_offer_deadline');

  const input = {
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
    lineItems: [
      {
        variantId: productVariantId,
        quantity: 1,
      },
    ],
    customAttributes: [
      { key: 'PHAM Standby Entry ID', value: standbyEntryId },
      { key: 'PHAM Edition', value: editionLabel || '' },
      { key: 'PHAM Product', value: productCode || '' },
      { key: 'PHAM Acquisition Type', value: 'Standby full price' },
    ],
    note: 'PHAM standby acquisition · ' + standbyEntryId,
    reserveInventoryUntil: new Date(offerDeadline).toISOString(),
    tags: [
      'PHAM',
      editionLabel || 'PHAM EDITION',
      'Standby Offer',
      standbyEntryId,
    ],
    visibleToCustomer: true,
  };

  if (customerId) input.purchasingEntity = { customerId };
  if (email) input.email = email;

  return { input };
}

export function buildStandbyInvoiceEmail({
  email,
  editionLabel,
  productCode,
  finalPriceCents,
  offerDeadline,
  currencyCode = 'USD',
}) {
  if (!email) throw new Error('missing_email');

  const price = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(finalPriceCents / 100);

  return {
    to: email,
    subject: (productCode || 'PHAM') + ' · an object is available',
    customMessage:
      'A place in ' +
      (editionLabel || 'PHAM Edition') +
      ' has become available. Your standby offer is for the full product price of ' +
      price +
      ' and expires at ' +
      new Date(offerDeadline).toISOString() +
      '. Shipping, taxes, and duties may apply at checkout where applicable.',
  };
}
