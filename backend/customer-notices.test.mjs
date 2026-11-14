import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCustomerNotice,noticeKey,notificationTransportConfigured,
  enqueueCustomerNotice,dispatchCustomerNotices,CUSTOMER_NOTICE_EVENTS
} from './customer-notices.mjs';

test('every PHAM transactional template is non-marketing and provides private collector link',()=>{
  for(const event of CUSTOMER_NOTICE_EVENTS){
    const m=buildCustomerNotice(event,{id:'PHAM-R-TEST'});
    assert.match(m.subject,/^PHAM/);
    assert.match(m.text,/PHAM-R-TEST/);
    assert.match(m.text,/https:\/\/phamofficial\.com\/pages\/reservation-status/);
    assert.match(m.text,/not a promotional email/);
    assert.doesNotMatch(m.text,/guaranteed profit|resale value/);
  }
  assert.match(buildCustomerNotice('refund_review',{id:'R'}).text,/NOT confirmation of a completed refund/);
  assert.throws(()=>buildCustomerNotice('discount_campaign',{id:'R'}),/unsupported_customer_notice/);
});
test('notification transport cannot send until merchant explicitly enables a verified sender',()=>{
  const env={PHAM_NOTIFICATIONS_ENABLED:'true',PHAM_RESEND_API_KEY:'re_demo',
    PHAM_NOTIFICATION_FROM:'PHAM <updates@phamofficial.com>',
    STOREFRONT_ORIGIN:'https://phamofficial.com'};
  assert.ok(notificationTransportConfigured(env));
  assert.equal(notificationTransportConfigured({...env,PHAM_NOTIFICATIONS_ENABLED:'false'}),false);
  assert.equal(notificationTransportConfigured({...env,PHAM_RESEND_API_KEY:''}),false);
  assert.equal(notificationTransportConfigured({...env,PHAM_NOTIFICATION_FROM:''}),false);
});
test('customer notices are keyed by exact reservation and event, no email in key',()=>{
  assert.equal(noticeKey('PHAM-R-X','reservation_confirmed'),'pham-e01:reservation_confirmed:PHAM-R-X');
  assert.notEqual(noticeKey('PHAM-R-X','reservation_confirmed'),noticeKey('PHAM-R-X','final_payment_paid'));
});
test('worker outbox accepts notification once and dispatches only with provider acknowledgement',async()=>{
  const rows=new Map();
  const reservation={id:'PHAM-R-TEST',email:'collector@example.com',edition_id:'edition-01'};
  const fakeDB={
    prepare(sql){
      const op={
        values:[],
        bind(...v){this.values=v;return this;},
        async run(){
          if(sql.includes('INSERT OR IGNORE INTO customer_notification_jobs')){
            const [id,edition_id,reservation_id,event_type]=this.values;
            if(rows.has(id))return {meta:{changes:0}};
            rows.set(id,{id,edition_id,reservation_id,event_type,status:'queued',attempt_count:0});
            return {meta:{changes:1}};
          }
          if(sql.includes("SET status='sending'")){
            const row=rows.get(this.values[0]);
            if(!row||row.status!=='queued')return {meta:{changes:0}};
            row.status='sending';row.attempt_count++;
            return {meta:{changes:1}};
          }
          if(sql.includes("SET status='sent'")){
            const row=rows.get(this.values[1]);row.status='sent';row.provider_id=this.values[0];return {meta:{changes:1}};
          }
          if(sql.includes("SET status='needs_review'")){
            const row=rows.get(this.values[1]);row.status='needs_review';row.last_error=this.values[0];return {meta:{changes:1}};
          }
          throw new Error('Unexpected SQL: '+sql);
        },
        async all(){
          if(sql.includes("FROM customer_notification_jobs n"))return {results:Array.from(rows.values()).filter(r=>r.status==='queued').map(r=>({...r,email:reservation.email}))};
          throw new Error('Unexpected SQL SELECT');
        }
      };
      return op;
    }
  };
  const base={PHAM_CAMPAIGN_DB:fakeDB,PHAM_NOTIFICATIONS_ENABLED:'false',PHAM_RESEND_API_KEY:'re_dummy',
    PHAM_NOTIFICATION_FROM:'PHAM <updates@phamofficial.com>',STOREFRONT_ORIGIN:'https://phamofficial.com'};
  await enqueueCustomerNotice(base,reservation.id,reservation.edition_id,'reservation_confirmed');
  await enqueueCustomerNotice(base,reservation.id,reservation.edition_id,'reservation_confirmed');
  assert.equal(rows.size,1);
  let calls=0;
  const never=async()=>{calls++;throw new Error('Not allowed to send');};
  assert.deepEqual(await dispatchCustomerNotices(base,never),{configured:false,attempted:0,sent:0});
  assert.equal(calls,0);
  const env={...base,PHAM_NOTIFICATIONS_ENABLED:'true'};
  const out=await dispatchCustomerNotices(env,async(url,options)=>{
    calls++;assert.equal(url,'https://api.resend.com/emails');
    assert.match(options.headers['Idempotency-Key'],/PHAM-R-TEST/);
    assert.equal(JSON.parse(options.body).to[0],'collector@example.com');
    return {ok:true,status:200,json:async()=>({id:'provider-message-id'})};
  });
  assert.equal(out.sent,1);
  assert.equal(rows.values().next().value.status,'sent');
  await dispatchCustomerNotices(env,never);
  assert.equal(calls,1);
});
