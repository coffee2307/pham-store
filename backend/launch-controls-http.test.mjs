import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const url='https://worker.pham.test/internal/window/resolve';
const headers={Authorization:'Bearer internal-test-secret','Content-Type':'application/json'};
function fixture(count=20){
 const edition={id:'edition-01',state:'reservation_closed',edition_size:50,release_quantity:50};
 let writes=0;
 const db={
   prepare(sql){
     const obj={
       args:[],
       bind(...args){this.args=args;return this;},
       async first(){
         if(sql.includes('FROM editions WHERE id=?'))return edition;
         if(sql.includes('COUNT(*) AS count FROM reservations'))return {count};
         throw Error('Unexpected query: '+sql);
       },
       async run(){
         if(sql.includes('UPDATE editions SET release_quantity')){
           writes++;
           edition.release_quantity=this.args[0];
           edition.partial_run_approved_at='2026-11-13T10:00:00Z';
           return {meta:{changes:1}};
         }
         if(sql.includes("UPDATE editions SET state='edition_cancelled'")){
           writes++;edition.state='edition_cancelled';
           return {meta:{changes:1}};
         }
         throw Error('Unexpected mutation: '+sql);
       }
     };
     return obj;
   }
 };
 return {env:{INTERNAL_ADMIN_KEY:'internal-test-secret',PHAM_CAMPAIGN_DB:db},edition,getWrites:()=>writes};
}
function req(body,authorized=true){
 return new Request(url,{method:'POST',headers:authorized?headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
}
test('HTTP underfilled window is private and requires 3 independent signoffs',async()=>{
 const x=fixture();
 const input={editionId:'edition-01',decision:'proceed_partial',
  approvalReference:'manufacturing-and-legal-approval-001',
  productionApproved:true,legalApproved:true,customerNoticeApproved:false,
  confirm:'RESOLVE_UNDERFILLED_EDITION'};
 let r=await worker.fetch(req(input,false),x.env);
 assert.equal(r.status,401);
 r=await worker.fetch(req(input),x.env);
 assert.equal(r.status,409);
 assert.equal((await r.json()).error,'partial_release_signoffs_required');
 assert.equal(x.getWrites(),0);
 r=await worker.fetch(req({...input,customerNoticeApproved:true}),x.env);
 assert.equal(r.status,200);
 const result=await r.json();
 assert.equal(result.plannedRunQuantity,20);
 assert.equal(result.merchantNoticeRequired,true);
 assert.equal(x.edition.release_quantity,20);
 assert.equal(x.getWrites(),1);
});
test('lookbook delivery cannot be marked without evidence, before any D1 write',async()=>{
 const env=fixture().env;
 const r=await worker.fetch(new Request('https://worker.pham.test/internal/lookbook/status',{
   method:'POST',headers,body:JSON.stringify({reservationId:'PHAM-R-X',status:'delivered'})
 }),env);
 assert.equal(r.status,422);
 assert.equal((await r.json()).error,'verified_lookbook_delivery_reference_required');
});
test('zero-order underfilled launch safely terminates without fake refunds',async()=>{
 const x=fixture(0);
 const r=await worker.fetch(req({
   editionId:'edition-01',decision:'refund_review',
   approvalReference:'merchant-approval-REFUND-0001',
   confirm:'RESOLVE_UNDERFILLED_EDITION'
 }),x.env);
 assert.equal(r.status,200);
 const result=await r.json();
 assert.equal(result.pendingReviewCount,0);
 assert.equal(result.automaticRefundsIssued,false);
 assert.equal(x.edition.state,'edition_cancelled');
});
