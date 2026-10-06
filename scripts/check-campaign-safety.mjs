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

const schemaRaw = fs.readFileSync('config/settings_schema.json', 'utf8');
const schema = JSON.parse(schemaRaw);
const schemaFailures = [];

for (const group of schema) {
  for (const setting of group.settings || []) {
    if (setting.type !== 'range') continue;
    const min = Number(setting.min);
    const max = Number(setting.max);
    const step = Number(setting.step ?? 1);
    if (![min, max, step].every(Number.isFinite) || step <= 0) continue;
    const steps = Math.floor((max - min) / step) + 1;
    if (steps > 101) {
      schemaFailures.push(
        `Theme range ${setting.id || '<unknown>'} has ${steps} steps; Shopify allows at most 101.`
      );
    }
  }
}

if (schemaFailures.length) {
  schemaFailures.forEach((message) => console.error('PHAM theme schema failure:', message));
  process.exit(1);
}

const failures = [];
const warnings = [];

const enabled = s.pham_campaign_enabled === true;
const commerceReady = s.pham_campaign_commerce_ready === true;
const includeLookbook = s.pham_campaign_include_digital_lookbook === true;
const lookbookReady = s.pham_campaign_lookbook_ready === true;
const engineEnabled = s.pham_campaign_engine_enabled === true;
const engineProxyPath = String(s.pham_campaign_engine_proxy_path || '').trim();
const configuredSizes = String(s.pham_campaign_size_options || 'XS,S,M,L,XL')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const uniqueConfiguredSizes = new Set(configuredSizes.map(value => value.toLowerCase()));

if (!enabled) {
  console.log('PHAM campaign safety: framework disabled.');
  process.exit(0);
}

if (lookbookReady && !s.pham_campaign_lookbook_product) {
  failures.push('DIGITAL LOOKBOOK READY is ON but no digital lookbook product is configured.');
}

if (engineEnabled && !engineProxyPath) {
  failures.push('ENGINE ENABLED is ON but no App Proxy path is configured.');
}

if (commerceReady) {
  if (!configuredSizes.length) {
    failures.push('COMMERCE READY is ON but no size preference options are configured.');
  }
  if (uniqueConfiguredSizes.size !== configuredSizes.length) {
    failures.push('COMMERCE READY is ON but size preference options contain duplicates.');
  }

  if (!engineEnabled) {
    failures.push('COMMERCE READY is ON but the Edition Engine is disabled.');
  }

  if (!engineProxyPath) {
    failures.push('COMMERCE READY is ON but no Edition Engine App Proxy path is configured.');
  }

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
