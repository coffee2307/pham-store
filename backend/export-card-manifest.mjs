/**
 * Export a print-shop handoff CSV for authenticated PHAM Edition 01 operators.
 * Only run on a trusted machine; the output contains private personalization data.
 *
 * node backend/export-card-manifest.mjs --output=C:/secure/PHAM-E01-private.csv
 * CAMPAIGN_BACKEND_URL and INTERNAL_ADMIN_KEY must be set.
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildCardManifestCsv } from './card-manifest.mjs';

const outputArg = process.argv.find(x=>x.startsWith('--output=')) || '';
const target = outputArg.slice('--output='.length);
if (!target || !target.toLowerCase().endsWith('.csv')) {
  console.error('Supply an explicit private --output=/secure/path/PHAM-E01.csv');
  process.exit(1);
}
const url = String(process.env.CAMPAIGN_BACKEND_URL || '').replace(/\/$/, '');
const key = process.env.INTERNAL_ADMIN_KEY || '';
if (!url.startsWith('https://') || !key) {
  console.error('HTTPS CAMPAIGN_BACKEND_URL and INTERNAL_ADMIN_KEY required.');
  process.exit(1);
}
const response = await fetch(url+'/internal/personalizations?edition=edition-01', {
  headers: { Authorization:'Bearer '+key, Accept:'application/json' },
  signal:AbortSignal.timeout(15000)
});
if (!response.ok) throw new Error('Operator API returned HTTP '+response.status);
const payload = await response.json();
if (!payload.ok || payload.privateOperatorData !== true || !Array.isArray(payload.items)) {
  throw new Error('Invalid private manifest response.');
}
const csv = buildCardManifestCsv(payload.items);
const absolute = path.resolve(target);
if(fs.existsSync(absolute)) throw new Error('Refusing to overwrite an existing production manifest.');
fs.writeFileSync(absolute, csv, {encoding:'utf8',flag:'wx',mode:0o600});
console.log('PRIVATE CARD MANIFEST: '+payload.items.length+' records. Do not publish or commit this CSV.');
