import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planReservationOpening,reservationWindowValid,canAcceptDatedReservation,
  isReservationWindowExpired,validateUnderfilledDecision
} from './reservation-window.mjs';

const opened=planReservationOpening('2026-11-13T03:00:00Z',14);
const edition={
  id:'edition-01',edition_size:50,state:'reservation_open',
  commerce_acceptance_enabled:1,
  reservation_opened_at:opened.openedAt,
  reservation_closes_at:opened.closesAt
};
test('exact 14 day window, UTC, no slipping beyond the deadline',()=>{
  assert.equal(opened.openedAt,'2026-11-13T03:00:00.000Z');
  assert.equal(opened.closesAt,'2026-11-27T03:00:00.000Z');
  assert.ok(reservationWindowValid(edition));
  assert.ok(canAcceptDatedReservation(edition,'2026-11-13T03:00:00.000Z'));
  assert.ok(canAcceptDatedReservation(edition,'2026-11-27T02:59:59.999Z'));
  assert.equal(canAcceptDatedReservation(edition,'2026-11-27T03:00:00.000Z'),false);
  assert.ok(isReservationWindowExpired(edition,'2026-11-27T03:00:00.000Z'));
  assert.ok(!isReservationWindowExpired(edition,'2026-11-27T02:59:59.999Z'));
});
test('no campaign state or stale legacy gate can bypass 14-day cutoff',()=>{
  assert.equal(canAcceptDatedReservation({...edition,state:'prelaunch'},'2026-11-14T03:00:00Z'),false);
  assert.equal(canAcceptDatedReservation({...edition,state:'reservation_closed'},'2026-11-14T03:00:00Z'),false);
  assert.equal(canAcceptDatedReservation({...edition,commerce_acceptance_enabled:0},'2026-11-14T03:00:00Z'),false);
  assert.equal(canAcceptDatedReservation({...edition,reservation_opened_at:null},'2026-11-14T03:00:00Z'),false);
  assert.equal(canAcceptDatedReservation({...edition,reservation_closes_at:'2026-12-30T03:00:00Z'},'2026-11-14T03:00:00Z'),false);
  assert.throws(()=>planReservationOpening(new Date(),15),/invalid_reservation_window/);
  assert.throws(()=>planReservationOpening(new Date(),0),/invalid_reservation_window/);
});
test('underfilled 20/50 requires explicit production, legal and customer-notice signoffs',()=>{
  const closed={edition_size:50,state:'reservation_closed'};
  const req={edition:closed,activeCount:20,decision:'proceed_partial',reference:'sample-and-legal-signed-2026-11-13',productionApproved:true,legalApproved:true,customerNoticeApproved:true};
  assert.equal(validateUnderfilledDecision(req).runQuantity,20);
  assert.throws(()=>validateUnderfilledDecision({...req,productionApproved:false}),/partial_release_signoffs_required/);
  assert.throws(()=>validateUnderfilledDecision({...req,customerNoticeApproved:false}),/partial_release_signoffs_required/);
  assert.throws(()=>validateUnderfilledDecision({...req,edition:{...closed,state:'reservation_open'}}),/edition_not_closed/);
  assert.throws(()=>validateUnderfilledDecision({...req,activeCount:50}),/not_an_underfilled_edition/);
  assert.throws(()=>validateUnderfilledDecision({...req,activeCount:0}),/no_orders_to_produce/);
});
test('refunding an underfilled launch only creates operator review, never silently refunds money',()=>{
  const input={edition:{state:'reservation_closed',edition_size:50},activeCount:0,decision:'refund_review',reference:'merchant-refund-decision-001'};
  const d=validateUnderfilledDecision(input);
  assert.equal(d.decision,'refund_review');
  assert.equal(d.runQuantity,0);
  assert.equal(d.activeReservations,0);
});
