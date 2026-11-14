import test from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const edition={id:'edition-01',state:'prelaunch',edition_size:50};
function fakeDb(rows=[]){
  return {
    prepare(query){
      return {
        bind(){
          return {
            async first(){
              if(query.includes('FROM editions')) return edition;
              return null;
            },
            async all(){
              if(query.includes('FROM reservations r')) return {results:rows};
              throw new Error('unexpected query in fixture');
            }
          };
        }
      };
    }
  };
}
test('private production ledger requires secret and never leaks customer identity',async()=>{
  const env={INTERNAL_ADMIN_KEY:'test-internal-key',PHAM_CAMPAIGN_DB:fakeDb([
    {id:'PHAM-R-1',object_number:1,status:'active',size_preference:'XL',
      identity_status:'configured',contact_verified_at:'2026-11-13',
      engraving_name:'CUSTOM ALIAS',email:'secret@example.com'}
  ])};
  const url='https://worker.example/internal/operations?edition=edition-01';
  let r=await worker.fetch(new Request(url),env);
  assert.equal(r.status,401);
  r=await worker.fetch(new Request(url,{headers:{Authorization:'Bearer wrong'}}),env);
  assert.equal(r.status,401);
  r=await worker.fetch(new Request(url,{headers:{Authorization:'Bearer test-internal-key'}}),env);
  assert.equal(r.status,200);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const raw=await r.text();
  const data=JSON.parse(raw);
  assert.equal(data.privateOperatorData,true);
  assert.equal(data.slots.length,50);
  assert.equal(data.counts.reserved,1);
  assert.ok(raw.includes('CUSTOM ALIAS'));
  assert.ok(!raw.includes('secret@example.com'));
});
test('private production ledger flags compromised capacity instead of returning a seemingly valid report',async()=>{
  const env={INTERNAL_ADMIN_KEY:'test-internal-key',PHAM_CAMPAIGN_DB:fakeDb([
    {id:'A',object_number:2},{id:'B',object_number:2}
  ])};
  const r=await worker.fetch(new Request('https://worker.example/internal/operations',{
    headers:{Authorization:'Bearer test-internal-key'}
  }),env);
  assert.equal(r.status,503);
  const data=await r.json();
  assert.equal(data.error,'operations_integrity_alert');
});
