import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePriorityReservationOrder,buildFinalAcquisitionDraftInput,
  validateFinalAcquisitionOrder,validateLifecycleTransition,
  visibleFounderTokenType,canAcceptPaidReservation
} from './worker.js';
import {planReservationOpening,validateUnderfilledDecision} from './reservation-window.mjs';
import {buildCustomerNotice} from './customer-notices.mjs';

/** OFFLINE integration scenario, not a real payment, Shopify E2E or email.
 * Real-money/real-delivery signoffs must not be inferred from this test.
 */
test('SIMULATED journey: $24.99 deposit + $5 card, $174.01 invoice, production to delivery',()=>{
  const w=planReservationOpening('2026-11-13T08:00:00Z',14);
  const edition={
    id:'edition-01',label:'EDITION 01',edition_size:50,
    state:'reservation_open',commerce_acceptance_enabled:1,
    reservation_opened_at:w.openedAt,reservation_closes_at:w.closesAt,
    product_code:'PHAM-001',currency_code:'USD',
    reservation_price_cents:2499,final_price_cents:19900,
    final_product_variant_id:'gid://shopify/ProductVariant/120'
  };
  assert.equal(canAcceptPaidReservation(edition,'2026-11-14T09:00:00Z'),true);
  const deposit={
    financial_status:'paid',email:'collector@example.com',currency:'USD',
    current_total_discounts:'0.00',current_subtotal_price:'29.99',
    line_items:[
      {sku:'PHAM-001-RES-E01',quantity:1,price:'24.99',properties:[
        {name:'_PHAM Edition',value:'EDITION 01'},
        {name:'_PHAM Product',value:'PHAM-001'},
        {name:'_PHAM Size Preference',value:'XL'},
        {name:'Reservation terms',value:'Accepted'},
        {name:'Digital lookbook delivery',value:'Included'}
      ]},
      {sku:'PHAM-LOOKBOOK-E01',quantity:1,price:'0.00'},
      {sku:'PHAM-ID-E01',quantity:1,price:'5.00'}
    ]
  };
  const validated=validatePriorityReservationOrder({order:deposit,edition});
  assert.equal(validated.reservationPaidCents,2499);
  assert.equal(validated.sizePreference,'XL');
  assert.ok(validated.identityLine);
  const reservation={
    id:'PHAM-R-001',status:'final_payment_open',
    email:'collector@example.com',
    shopify_customer_id:'gid://shopify/Customer/456',
    final_variant_id:'gid://shopify/ProductVariant/789',
    size_preference:'XL',
    payment_deadline:'2026-11-29T12:00:00Z'
  };
  const invoice=buildFinalAcquisitionDraftInput({
    edition,reservation,variantId:reservation.final_variant_id,
    deadline:reservation.payment_deadline
  });
  assert.equal(invoice.lineItems[0].quantity,1);
  assert.equal(invoice.appliedDiscount.value,'24.99');
  const paid=validateFinalAcquisitionOrder({
    edition,reservation,
    order:{
      financial_status:'paid',currency:'USD',
      processed_at:'2026-11-29T11:59:00Z',
      current_total_discounts:'24.99',customer:{id:456},
      line_items:[{variant_id:789,quantity:1,price:'199.00',sku:'PHAM-001-E01-XL'}]
    }
  });
  assert.equal(paid.ok,true);
  assert.equal(paid.discountCents,2499);
  let stage='production_queued';
  for(const next of ['in_production','quality_control','packed','dispatched','delivered']){
    assert.equal(validateLifecycleTransition(stage,next).changed,true);
    stage=next;
  }
  assert.equal(visibleFounderTokenType('gold','packed'),'sealed');
  assert.equal(visibleFounderTokenType('gold','delivered'),'gold');
  assert.match(buildCustomerNotice('reservation_confirmed',reservation).text,/not yet been permanently allocated/);
  assert.match(buildCustomerNotice('payment_reminder_24h',reservation).text,/official Shopify invoice/);
});
test('SIMULATED underfilled journey never triggers unapproved invoice or false refund receipt',()=>{
  const closed={state:'reservation_closed',edition_size:50};
  assert.throws(()=>validateUnderfilledDecision({
    edition:closed,activeCount:20,decision:'proceed_partial',reference:'factory-signoff-2026',
    productionApproved:false,legalApproved:true,customerNoticeApproved:true
  }),/partial_release_signoffs_required/);
  const refund=buildCustomerNotice('refund_review',{id:'PHAM-R-002'});
  assert.match(refund.text,/NOT confirmation/);
});
