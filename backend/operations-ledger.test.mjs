import test from 'node:test';
import assert from 'node:assert/strict';
import {compileEditionOperations} from './operations-ledger.mjs';

const edition = {id:'edition-01',state:'prelaunch',edition_size:50};
test('private production board produces exactly 50 slots without exposing addresses or emails',()=>{
  const report = compileEditionOperations(edition,[
    {id:'PHAM-R-1',object_number:11,size_preference:'XL',status:'final_paid',
     lifecycle_stage:'quality_control',identity_status:'configured',
     contact_verified_at:'2026-11-13',engraving_name:'My Alias',
     engraving_text:'Personal inscription',production_notes:'Align the letters',
     email:'never-export@example.com',shipping_address:'private'},
    {id:'PHAM-R-2',object_number:null,status:'active',size_preference:'M',
     identity_status:'claimed',lifecycle_stage:'not_started'}
  ]);
  assert.equal(report.slots.length,50);
  assert.equal(report.slots[10].state,'assigned');
  assert.equal(report.slots[10].reservationId,'PHAM-R-1');
  assert.equal(report.slots[11].state,'unassigned');
  assert.equal(report.counts.reserved,2);
  assert.equal(report.counts.unassignedSlots,49);
  assert.equal(report.counts.awaitingObjectNumber,1);
  assert.equal(report.counts.acquired,1);
  assert.equal(report.concerns.unverifiedIdentity,1);
  assert.equal(report.concerns.finalPaymentPending,1);
  assert.equal(report.stageCounts.quality_control,1);
  assert.equal(report.reservations[0].printedName,'My Alias');
  assert.equal(report.reservations[1].printedName,null);
  assert.doesNotMatch(JSON.stringify(report),/never-export@example.com|shipping_address|private"/);
});
test('board refuses overcapacity, duplicate records and duplicate numbers',()=>{
  assert.throws(()=>compileEditionOperations(edition,Array.from({length:51},(_,i)=>({id:String(i)}))),/invalid_active_reservation_count/);
  assert.throws(()=>compileEditionOperations(edition,[{id:'A',object_number:1},{id:'A',object_number:2}]),/invalid_or_duplicate_reservation/);
  assert.throws(()=>compileEditionOperations(edition,[{id:'A',object_number:1},{id:'B',object_number:1}]),/duplicate_object_number/);
  assert.throws(()=>compileEditionOperations(edition,[{id:'A',object_number:51}]),/object_number_out_of_range/);
  assert.throws(()=>compileEditionOperations(edition,[{id:'A',lifecycle_stage:'made_up'}]),/invalid_lifecycle_stage/);
});
test('manual card instructions are not exported without verified correspondence',()=>{
  const report=compileEditionOperations(edition,[{id:'A',object_number:5,
    identity_status:'configured',engraving_name:'Unverified secret',
    engraving_text:'Private text',production_notes:'Private notes',
    contact_verified_at:null}]);
  assert.equal(report.reservations[0].cardStatus,'awaiting_manual_confirmation');
  assert.equal(report.reservations[0].printedName,null);
  assert.equal(report.reservations[0].specialInstructions,null);
  assert.doesNotMatch(JSON.stringify(report),/Unverified secret|Private text|Private notes/);
});
