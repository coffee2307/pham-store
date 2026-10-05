import { finalBalanceCents } from '../domain/rules.js';

export const CREATE_FINAL_PAYMENT_DRAFT_ORDER = [
  'mutation PhamCreateFinalPaymentDraft($input: DraftOrderInput!) {',
  '  draftOrderCreate(input: $input) {',
  '    draftOrder {',
  '      id',
  '      name',
  '      invoiceUrl',
  '      email',
  '      reserveInventoryUntil',
  '      subtotalPriceSet { shopMoney { amount currencyCode } }',
  '      totalDiscountsSet { shopMoney { amount currencyCode } }',
  '      totalPriceSet { shopMoney { amount currencyCode } }',
  '    }',
  '    userErrors { field message }',
  '  }',
  '}',
].join('\n');

export const SEND_FINAL_PAYMENT_INVOICE = [
  'mutation PhamSendFinalPaymentInvoice($id: ID!, $email: EmailInput) {',
  '  draftOrderInvoiceSend(id: $id, email: $email) {',
  '    draftOrder {',
  '      id',
  '      invoiceSentAt',
  '      invoiceUrl',
  '    }',
  '    userErrors { field message }',
  '  }',
  '}',
].join('\n');

export function shopifyCustomerGid(customerId) {
  const value = String(customerId || '').trim();
  if (!value) return '';
  if (value.startsWith('gid://shopify/Customer/')) return value;
  if (!/^\d+$/.test(value)) throw new Error('invalid_shopify_customer_id');
  return 'gid://shopify/Customer/' + value;
}

function centsToMoney(cents) {
  if (!Number.isInteger(cents) || cents < 0) throw new Error('invalid_money_cents');
  return Number((cents / 100).toFixed(2));
}

export function buildFinalPaymentDraftOrderInput({
  customerId,
  email,
  productVariantId,
  reservationId,
  editionLabel,
  productCode,
  sizePreference = '',
  finalPriceCents,
  reservationCreditCents,
  currencyCode = 'USD',
  paymentDeadline,
}) {
  if (!productVariantId) throw new Error('missing_product_variant');
  if (!reservationId) throw new Error('missing_reservation_id');
  if (!paymentDeadline) throw new Error('missing_payment_deadline');

  const expectedBalanceCents = finalBalanceCents(
    finalPriceCents,
    reservationCreditCents
  );

  const input = {
    acceptAutomaticDiscounts: false,
    allowDiscountCodesInCheckout: false,
    appliedDiscount: {
      title: 'Priority Reservation Credit',
      description: (editionLabel || 'PHAM Edition') + ' reservation credit',
      value: centsToMoney(reservationCreditCents),
      valueType: 'FIXED_AMOUNT',
    },
    lineItems: [
      {
        variantId: productVariantId,
        quantity: 1,
      },
    ],
    customAttributes: [
      { key: 'PHAM Reservation ID', value: reservationId },
      { key: 'PHAM Edition', value: editionLabel || '' },
      { key: 'PHAM Product', value: productCode || '' },
      { key: 'PHAM Size Preference', value: String(sizePreference || '') },
    ],
    note: 'PHAM final acquisition · ' + reservationId,
    reserveInventoryUntil: new Date(paymentDeadline).toISOString(),
    tags: [
      'PHAM',
      editionLabel || 'PHAM EDITION',
      'Final Payment',
      reservationId,
    ],
    visibleToCustomer: true,
  };

  if (customerId) {
    input.purchasingEntity = { customerId: shopifyCustomerGid(customerId) };
  }
  if (email) {
    input.email = email;
  }

  return {
    input,
    expectedBalanceCents,
    currencyCode,
  };
}

export function buildFinalPaymentInvoiceEmail({
  email,
  editionLabel,
  productCode,
  balanceDueCents,
  paymentDeadline,
  currencyCode = 'USD',
}) {
  if (!email) throw new Error('missing_email');

  const balance = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
  }).format(balanceDueCents / 100);

  return {
    to: email,
    subject: (productCode || 'PHAM') + ' · acquisition window open',
    customMessage:
      (editionLabel || 'PHAM Edition') +
      ' is ready to be confirmed. Your remaining product balance is ' +
      balance +
      '. Complete payment before ' +
      new Date(paymentDeadline).toISOString() +
      '. Shipping, taxes, and duties may apply at checkout where applicable.',
  };
}

export function assertDraftOrderBalance(draftOrder, {
  expectedBalanceCents,
  currencyCode = 'USD',
}) {
  const money = draftOrder && draftOrder.totalPriceSet && draftOrder.totalPriceSet.shopMoney;
  if (!money) throw new Error('draft_order_total_missing');

  const actualCents = Math.round(Number(money.amount) * 100);
  if (money.currencyCode !== currencyCode) {
    throw new Error('draft_order_currency_mismatch');
  }
  if (actualCents !== expectedBalanceCents) {
    throw new Error(
      'draft_order_balance_mismatch:' + actualCents + ':' + expectedBalanceCents
    );
  }
  return true;
}
