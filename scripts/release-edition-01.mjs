/**
 * PHAM Edition 01 single-action release gate.
 * Run only after the live theme has been staged with commerce/lookbook readiness.
 * All external commercial/legal confirmations must be explicitly recorded by
 * the merchant; this script never infers compliance from a passing code check.
 */
import fs from 'node:fs';

const mode = process.argv[2] || 'preflight';
const required = [
  'PHAM_LEGAL_SIGNOFF',
  'PHAM_PAYMENT_TEST_SIGNOFF',
  'PHAM_LOOKBOOK_DELIVERY_SIGNOFF',
  'PHAM_PRODUCTION_SIGNOFF',
  'PHAM_SHIPPING_TAX_SIGNOFF',
  'PHAM_DATA_PROTECTION_SIGNOFF',
  'PHAM_THEME_DEPLOYED_SIGNOFF',
  'PHAM_WEBHOOK_E2E_SIGNOFF'
];

function fail(message) {
  console.error('RELEASE BLOCKED: ' + message);
  process.exit(1);
}

if (!['preflight','launch'].includes(mode)) fail('Expected preflight or launch');
const raw = fs.readFileSync('config/settings_data.json', 'utf8');
const settings = JSON.parse(raw.slice(raw.indexOf('{'))).current || {};
for (const [label, ok] of [
  ['Edition engine configured', settings.pham_campaign_engine_enabled === true],
  ['Live commerce gate explicitly ready', settings.pham_campaign_commerce_ready === true],
  ['Verified real lookbook ready', settings.pham_campaign_lookbook_ready === true],
  ['Canonical sizes', settings.pham_campaign_size_options === 'M,L,XL,XXL'],
  ['Release theme is Edition 01', settings.pham_campaign_edition_id === 'edition-01'],
]) {
  if (!ok) fail(label + ' is not confirmed in the fetched live theme settings.');
}
for (const key of required) {
  if (process.env[key] !== 'APPROVED') fail(key + ' must be explicitly APPROVED by the responsible operator.');
}
const base = String(process.env.CAMPAIGN_BACKEND_URL || '').replace(/\/$/, '');
const key = process.env.INTERNAL_ADMIN_KEY || '';
if (!base.startsWith('https://') || !key) fail('Worker URL or internal administrator credentials are missing.');
const headers = {Authorization: 'Bearer ' + key, Accept: 'application/json'};
async function api(path, options={}) {
  const response = await fetch(base+path, {
    method: options.method || 'GET',
    headers: {...headers, ...(options.body?{'Content-Type':'application/json'}:{})},
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: AbortSignal.timeout(18000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const failed = Array.isArray(payload.checks) ? payload.checks.filter(x=>!x.ok).map(x=>x.name) : [];
    fail(path + ' returned HTTP ' + response.status + (failed.length?': '+failed.join(', '):''));
  }
  return payload;
}
const ready = await api('/internal/readiness?edition=edition-01');
if (!ready.ok) fail('Backend readiness did not pass.');
const status = await api('/internal/state?edition=edition-01');
if (!status.edition || status.edition.id !== 'edition-01') fail('Wrong edition.');
if (status.edition.state !== 'prelaunch') fail('Edition is not safely in prelaunch. Current state: '+status.edition.state);
if ((status.counters && Number(status.counters.reserved)) !== 0) fail('Reservations already exist. Manual reconciliation required.');
console.log('PASS: staged live theme flags, operator signoffs, backend readiness and closed Edition 01 state.');
if (mode === 'preflight') {
  console.log('Preflight only. No state was changed.');
  process.exit(0);
}
if (process.env.RELEASE_CONFIRMATION !== 'OPEN_EDITION_01') fail('Explicit confirmation text missing.');
const opened = await api('/internal/state/set', {
  method:'POST',
  body:{editionId:'edition-01',state:'reservation_open',confirm:'SET_CAMPAIGN_STATE'}
});
const verified = await api('/internal/state?edition=edition-01');
if (!verified.edition || verified.edition.state !== 'reservation_open') fail('State-change response did not verify open; investigate immediately.');
console.log('EDITION 01 OPENED: release state verified. Order monitoring and support must be staffed.');
