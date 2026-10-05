import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertDraftOrderBalance,
  buildFinalPaymentDraftOrderInput,
  buildFinalPaymentInvoiceEmail,
} from '../src/shopify/final-payment.js';

test('Edition 01 final payment draft is $199 less $24.99 reservation credit', () => {
  const deadline = '2026-11-13T11:00:00.000Z';

  const built = buildFinalPaymentDraftOrderInput({
    customerId: 'gid://shopify/Customer/1',
    email: 'collector@example.com',
    productVariantId: 'gid://shopify/ProductVariant/PHAM001',
    reservationId: 'PHAM-R-000001',
    editionLabel: 'EDITION 01',
    productCode: 'PHAM-001',
    sizePreference: 'M',
    finalPriceCents: 19900,
    reservationCreditCents: 2499,
    currencyCode: 'USD',
    paymentDeadline: deadline,
  });

  assert.equal(built.expectedBalanceCents, 17401);
  assert.equal(built.input.appliedDiscount.value, 24.99);
  assert.equal(built.input.appliedDiscount.valueType, 'FIXED_AMOUNT');
  assert.equal(built.input.acceptAutomaticDiscounts, false);
  assert.equal(built.input.allowDiscountCodesInCheckout, false);
  assert.equal(built.input.reserveInventoryUntil, deadline);
  assert.deepEqual(built.input.purchasingEntity, {
    customerId: 'gid://shopify/Customer/1',
  });
  assert.deepEqual(
    built.input.customAttributes.find((x) => x.key === 'PHAM Size Preference'),
    { key: 'PHAM Size Preference', value: 'M' }
  );
});

test('final payment email states product balance and payment deadline', () => {
  const email = buildFinalPaymentInvoiceEmail({
    email: 'collector@example.com',
    editionLabel: 'EDITION 01',
    productCode: 'PHAM-001',
    balanceDueCents: 17401,
    paymentDeadline: '2026-11-13T11:00:00.000Z',
    currencyCode: 'USD',
  });

  assert.equal(email.to, 'collector@example.com');
  assert.match(email.customMessage, /\$174\.01/);
  assert.match(email.customMessage, /Shipping, taxes, and duties may apply/);
});

test('draft order total must match expected product balance before sending invoice', () => {
  assert.equal(
    assertDraftOrderBalance(
      {
        totalPriceSet: {
          shopMoney: { amount: '174.01', currencyCode: 'USD' },
        },
      },
      { expectedBalanceCents: 17401, currencyCode: 'USD' }
    ),
    true
  );

  assert.throws(
    () => assertDraftOrderBalance(
      {
        totalPriceSet: {
          shopMoney: { amount: '199.00', currencyCode: 'USD' },
        },
      },
      { expectedBalanceCents: 17401, currencyCode: 'USD' }
    ),
    /draft_order_balance_mismatch/
  );
});
