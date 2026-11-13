/** PHAM Edition 01 reservation deadline and underfilled-run decisions.
 * Time gates are UTC, not viewer/device timezone. An edition can open for at
 * most 14 × 24 hours. The deadline closes intake even if the cron runs late.
 */
export const MAX_RESERVATION_DAYS = 14;
export function planReservationOpening(now = new Date(), days = 14) {
  const stamp = new Date(now);
  if (!Number.isFinite(stamp.getTime()) || !Number.isInteger(Number(days)) ||
      Number(days)<1 || Number(days)>MAX_RESERVATION_DAYS) {
    throw new Error('invalid_reservation_window');
  }
  return {
    openedAt:stamp.toISOString(),
    closesAt:new Date(stamp.getTime()+Number(days)*86400000).toISOString(),
    maxDays:MAX_RESERVATION_DAYS
  };
}
export function reservationWindowValid(edition){
  if (!edition) return false;
  const opened=Date.parse(edition.reservation_opened_at||'');
  const closes=Date.parse(edition.reservation_closes_at||'');
  if(!Number.isFinite(opened)||!Number.isFinite(closes))return false;
  return closes>opened && closes-opened<=MAX_RESERVATION_DAYS*86400000;
}
export function canAcceptDatedReservation(edition, now=new Date()){
  const at=new Date(now).getTime();
  return Boolean(
    edition && edition.state==='reservation_open' &&
    Number(edition.commerce_acceptance_enabled)===1 &&
    Number.isFinite(at) && reservationWindowValid(edition) &&
    at>=Date.parse(edition.reservation_opened_at) &&
    at<Date.parse(edition.reservation_closes_at)
  );
}
export function isReservationWindowExpired(edition, now=new Date()){
  return Boolean(edition && edition.state==='reservation_open' &&
    reservationWindowValid(edition) &&
    new Date(now).getTime()>=Date.parse(edition.reservation_closes_at));
}
export function validateUnderfilledDecision({edition,activeCount,decision,reference,productionApproved,legalApproved,customerNoticeApproved}){
  if(!edition || edition.state!=='reservation_closed')
    throw new Error('edition_not_closed');
  if(edition.partial_run_approved_at)
    throw new Error('underfill_decision_already_recorded');
  const amount=Number(activeCount), cap=Number(edition.edition_size);
  if(!Number.isInteger(amount)||!Number.isInteger(cap)||amount<0||amount>=cap)
    throw new Error('not_an_underfilled_edition');
  if(!['proceed_partial','refund_review'].includes(decision))
    throw new Error('invalid_underfill_decision');
  const cleanReference=typeof reference==='string'?reference.trim():'';
  if(cleanReference.length<12||cleanReference.length>160||/[<>\u0000-\u001f]/.test(cleanReference))
    throw new Error('decision_evidence_reference_required');
  if(decision==='proceed_partial'){
    if(amount===0)throw new Error('no_orders_to_produce');
    if(productionApproved!==true||legalApproved!==true||customerNoticeApproved!==true){
      throw new Error('partial_release_signoffs_required');
    }
  }
  return {decision,runQuantity:decision==='proceed_partial'?amount:0,
    activeReservations:amount,reference:cleanReference};
}
