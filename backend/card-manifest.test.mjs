import test from 'node:test';
import assert from 'node:assert/strict';
import {safeCsvCell, buildCardManifestCsv} from './card-manifest.mjs';

test('card export escapes quotes and spreadsheet formulas', () => {
  assert.equal(safeCsvCell('A "quote"'), '"A ""quote"""');
  assert.equal(safeCsvCell('=2+2'), '"\'=2+2"');
  assert.equal(safeCsvCell('+SUM(A1)'), '"\'+SUM(A1)"');
  assert.equal(safeCsvCell('-1'), '"\'-1"');
});
test('card export contains only approved production columns and max 50 records', () => {
  const data = buildCardManifestCsv([{reservation_id:'PHAM-R-X',preferred_number:11,engraving_name:'Coffee',production_notes:'Centre text'}]);
  assert.ok(data.includes('Coffee'));
  assert.ok(data.includes('Centre text'));
  assert.ok(data.includes('PHAM-R-X'));
  assert.ok(!data.includes('Email'));
  assert.ok(!data.includes('Shipping address'));
  assert.throws(() => buildCardManifestCsv(Array.from({length:51},(_,i)=>({reservation_id:String(i)}))),/invalid_manifest_size/);
  assert.throws(() => buildCardManifestCsv([{reservation_id:'A'},{reservation_id:'A'}]),/duplicate_or_missing_reservation/);
});
