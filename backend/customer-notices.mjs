/** Transactional, privacy-minimizing PHAM notice outbox.
 * No email is sent until an authenticated production Worker has BOTH:
 * PHAM_NOTIFICATIONS_ENABLED=true, PHAM_RESEND_API_KEY and PHAM_NOTIFICATION_FROM.
 * All send receipts remain separate from Shopify's built-in invoice/receipt mail.
 */
export const CUSTOMER_NOTICE_EVENTS=Object.freeze([
  'reservation_confirmed','window_closed_review','refund_review',
  'refund_completed','final_payment_paid','lookbook_delivered',
  'identity_confirmed','production_started','quality_control',
  'packed','dispatched','delivered','payment_reminder_24h',
  'payment_reminder_3h'
]);
const ALLOWED=new Set(CUSTOMER_NOTICE_EVENTS);

export function buildCustomerNotice(event, reservation, origin='https://phamofficial.com') {
  if(!ALLOWED.has(event))throw new Error('unsupported_customer_notice');
  if(!reservation || !reservation.id)throw new Error('notice_requires_reservation');
  const base=String(origin||'').replace(/\/$/,'');
  if(!/^https:\/\/[\w.-]+(?::\d+)?$/.test(base))throw new Error('invalid_storefront_origin');
  const ref=String(reservation.id).slice(0,100);
  const recordUrl=base+'/pages/reservation-status';
  const lines={
    reservation_confirmed:['Reservation confirmed','Your PHAM-001 deposit has been recorded. It contributes to your final jacket price. Your number has not yet been permanently allocated.'],
    window_closed_review:['Reservation window closed','The maximum 14-day PHAM-001 reservation window has ended. PHAM is reviewing the confirmed orders. Do not pay any additional balance until you receive an official Shopify invoice.'],
    refund_review:['Refund review initiated','PHAM will reconcile your reservation with Shopify. This notice is NOT confirmation of a completed refund. We will contact you after verification.'],
    refund_completed:['Refund recorded','PHAM has recorded a refund that the operator verified in Shopify. Please check the original payment method and contact us if anything appears incorrect.'],
    final_payment_paid:['Final acquisition confirmed','Your PHAM-001 final payment has been recorded and your jacket is queued for production.'],
    lookbook_delivered:['Your Collector Lookbook','PHAM has marked your collector lookbook as delivered after checking an actual delivery reference. Contact the atelier if you did not receive it.'],
    identity_confirmed:['Your Object Identity request','PHAM reviewed your personalisation message and recorded the confirmed instructions. Consult your collector record for the current status.'],
    production_started:['Your jacket is in production','Your PHAM-001 order has moved into physical production. Production dates are estimates, not guaranteed delivery dates.'],
    quality_control:['PHAM-001 quality inspection','Your jacket has reached quality control. Final packing follows only after the inspection is cleared.'],
    packed:['PHAM-001 packaged','Your jacket and collector materials are recorded as packed. Tracking will appear after dispatch.'],
    dispatched:['PHAM-001 dispatched','Your PHAM-001 package has been dispatched. Tracking is available in your private collector record.'],
    delivered:['PHAM-001 delivered','Delivery has been recorded. Your Birth Record and Founder’s Token reveal state may now be available in Collector Access.'],
    payment_reminder_24h:['PHAM-001 payment window','Your remaining-payment deadline is approaching (within 24 hours). Use only the official Shopify invoice linked from your verified collector account.'],
    payment_reminder_3h:['PHAM-001 final payment reminder','Your remaining-payment deadline is approaching (within 3 hours). If you need help, contact PHAM before the published deadline.']
  };
  const [subject,message]=lines[event];
  return {
    subject:'PHAM · '+subject,
    text:[
      'PHAM / EDITION 01',
      '',
      message,
      '',
      'Reservation reference: '+ref,
      'Private collector record: '+recordUrl,
      'Support: contact@phamofficial.com',
      '',
      'This is an operational message about your PHAM reservation, not a promotional email.'
    ].join('\n')
  };
}
export function noticeKey(reservationId,event){
  if(!ALLOWED.has(event)||!reservationId||String(reservationId).length>100)
    throw new Error('invalid_notice_key');
  return 'pham-e01:'+event+':'+String(reservationId);
}
export async function enqueueCustomerNotice(env,reservationId,editionId,event){
  const id=noticeKey(reservationId,event);
  await env.PHAM_CAMPAIGN_DB.prepare(
    `INSERT OR IGNORE INTO customer_notification_jobs
      (id,edition_id,reservation_id,event_type)
     VALUES(?,?,?,?)`
  ).bind(id,editionId,reservationId,event).run();
  return id;
}
export function notificationTransportConfigured(env){
  return Boolean(env.PHAM_NOTIFICATIONS_ENABLED==='true' &&
    typeof env.PHAM_RESEND_API_KEY==='string' &&
    env.PHAM_RESEND_API_KEY.startsWith('re_') &&
    typeof env.PHAM_NOTIFICATION_FROM==='string' &&
    /@/.test(env.PHAM_NOTIFICATION_FROM) &&
    /^https:\/\//.test(String(env.STOREFRONT_ORIGIN||'')));
}
export async function dispatchCustomerNotices(env,send=fetch){
  if(!notificationTransportConfigured(env))return {configured:false,attempted:0,sent:0};
  const rows=await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT n.id,n.reservation_id,n.event_type,r.email
     FROM customer_notification_jobs n
     JOIN reservations r ON r.id=n.reservation_id
     WHERE n.status='queued' AND n.attempt_count=0
     ORDER BY n.created_at ASC,n.id ASC LIMIT 5`
  ).all();
  let attempted=0,sent=0,needsReview=0;
  for(const job of rows.results||[]){
    const claim=await env.PHAM_CAMPAIGN_DB.prepare(
      `UPDATE customer_notification_jobs
       SET status='sending',attempt_count=attempt_count+1
       WHERE id=? AND status='queued' AND attempt_count=0`
    ).bind(job.id).run();
    if(!claim?.meta?.changes)continue;
    attempted+=1;
    try{
      if(!/^\S+@\S+\.\S+$/.test(job.email||''))throw new Error('customer_email_missing');
      const notice=buildCustomerNotice(job.event_type,{id:job.reservation_id},env.STOREFRONT_ORIGIN);
      const response=await send('https://api.resend.com/emails',{
        method:'POST',
        headers:{
          'Authorization':'Bearer '+env.PHAM_RESEND_API_KEY,
          'Content-Type':'application/json',
          'Idempotency-Key':job.id.slice(0,200)
        },
        body:JSON.stringify({
          from:env.PHAM_NOTIFICATION_FROM,
          to:[job.email],
          reply_to:'contact@phamofficial.com',
          subject:notice.subject,
          text:notice.text
        }),
        signal:AbortSignal.timeout(15000)
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok||!payload.id)throw new Error('provider_rejected_notice_HTTP_'+response.status);
      await env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE customer_notification_jobs
          SET status='sent',provider_id=?,sent_at=CURRENT_TIMESTAMP,last_error=NULL
          WHERE id=? AND status='sending'`
      ).bind(String(payload.id).slice(0,120),job.id).run();
      sent+=1;
    }catch(error){
      // Failed/ambiguous sends are NOT auto-retried: avoid duplicate notices.
      // Staff must review the provider and manually retry with the same idempotency key.
      await env.PHAM_CAMPAIGN_DB.prepare(
        `UPDATE customer_notification_jobs
          SET status='needs_review',last_error=?
          WHERE id=? AND status='sending'`
      ).bind(String(error?.message||'unknown_error').slice(0,160),job.id).run();
      needsReview+=1;
    }
  }
  return {configured:true,attempted,sent,needsReview};
}
export async function enqueuePaymentReminders(env,now=new Date()){
  const nowIso=new Date(now).toISOString();
  const due=await env.PHAM_CAMPAIGN_DB.prepare(
    `SELECT id,edition_id,payment_deadline FROM reservations
      WHERE status='final_payment_open' AND payment_deadline>? AND payment_deadline<=?
      ORDER BY payment_deadline ASC LIMIT 100`
  ).bind(nowIso,new Date(Date.parse(nowIso)+24*3600000).toISOString()).all();
  let queued=0;
  for(const r of due.results||[]){
    const hours=(Date.parse(r.payment_deadline)-Date.parse(nowIso))/3600000;
    if(!Number.isFinite(hours)||hours<=0)continue;
    const event=hours<=3?'payment_reminder_3h':'payment_reminder_24h';
    await enqueueCustomerNotice(env,r.id,r.edition_id,event);
    queued++;
    if(hours<=3)await enqueueCustomerNotice(env,r.id,r.edition_id,'payment_reminder_24h');
  }
  return {queued};
}
