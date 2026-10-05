import fs from 'node:fs';

const path = 'config/settings_data.json';
const raw = fs.readFileSync(path, 'utf8');
const jsonStart = raw.indexOf('{');

if (jsonStart < 0) {
  console.error('PHAM campaign safety: settings_data.json has no JSON payload.');
  process.exit(1);
}

const data = JSON.parse(raw.slice(jsonStart));
const s = data.current || {};

const failures = [];
const warnings = [];

const enabled = s.pham_campaign_enabled === true;
const commerceReady = s.pham_campaign_commerce_ready === true;
const includeLookbook = s.pham_campaign_include_digital_lookbook === true;
const lookbookReady = s.pham_campaign_lookbook_ready === true;

if (!enabled) {
  console.log('PHAM campaign safety: framework disabled.');
  process.exit(0);
}

if (lookbookReady && !s.pham_campaign_lookbook_product) {
  failures.push('DIGITAL LOOKBOOK READY is ON but no digital lookbook product is configured.');
}

if (commerceReady) {
  if (!s.pham_campaign_reservation_product) {
    failures.push('COMMERCE READY is ON but no reservation product is configured.');
  }

  if (!s.pham_campaign_reservation_page_url) {
    failures.push('COMMERCE READY is ON but no reservation page URL is configured.');
  }

  if (!s.pham_campaign_terms_page_url) {
    failures.push('COMMERCE READY is ON but no edition terms page URL is configured.');
  }

  if (includeLookbook) {
    if (!lookbookReady) {
      failures.push('COMMERCE READY is ON while the included digital lookbook is not marked READY.');
    }
    if (!s.pham_campaign_lookbook_product) {
      failures.push('COMMERCE READY is ON while no lookbook product is configured.');
    }
  }

  for (const key of [
    'pham_campaign_reservation_price',
    'pham_campaign_final_price',
    'pham_campaign_balance_due'
  ]) {
    if (!s[key]) failures.push(`COMMERCE READY is ON but ${key} is empty.`);
  }
}

if (s.pham_campaign_state === 'reservation_open' && !commerceReady) {
  warnings.push('Campaign state is RESERVATION OPEN but COMMERCE READY is OFF. Checkout will remain safely disabled.');
}

warnings.forEach((message) => console.warn('PHAM campaign safety warning:', message));

if (failures.length) {
  failures.forEach((message) => console.error('PHAM campaign safety failure:', message));
  process.exit(1);
}

console.log('PHAM campaign safety: launch gates are internally consistent.');
