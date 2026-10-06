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

const edition01SizeGuide = 'M,L,XL,XXL';
const sizeGuideFiles = [
  'sections/pham-size-guide.liquid',
  'templates/page.pham-001-size-guide.json'
];

if (String(s.pham_campaign_size_options || '') !== edition01SizeGuide) {
  failures.push('Edition 01 size contract must be M,L,XL,XXL.');
}

for (const file of sizeGuideFiles) {
  if (!fs.existsSync(file)) {
    failures.push(`Edition 01 size guide failure: missing ${file}.`);
  }
}

const edition01ProductTemplate = fs.readFileSync('templates/product.json', 'utf8');
const edition01Reservation = fs.readFileSync('sections/pham-reservation-gateway.liquid', 'utf8');
if (!edition01ProductTemplate.includes('"size_guide_handle": "pham-001-size-guide"')) {
  failures.push('PHAM-001 product template must link to its Edition-specific size guide.');
}
if (!edition01Reservation.includes("pham_campaign_size_guide_page_url")) {
  failures.push('Edition 01 reservation flow must link to the PHAM-001 size guide.');
}

if (fs.existsSync('sections/pham-size-guide.liquid')) {
  const sizeGuide = fs.readFileSync('sections/pham-size-guide.liquid', 'utf8');
  for (const size of ['M', 'L', 'XL', 'XXL']) {
    if (!sizeGuide.includes(`data-pham-fit-size="${size}"`)) {
      failures.push(`Edition 01 size guide failure: missing ${size} fit row.`);
    }
  }
  if (!sizeGuide.includes('data-pham-fit-form') || !sizeGuide.includes('data-pham-fit-result')) {
    failures.push('Edition 01 size guide failure: fit-assistant form/result hooks are required.');
  }
  for (const marker of [
    'data-intended-ease="{{ section.settings.intended_chest_ease | default: 30 }}"',
    '"default":65',
    '"default":67',
    '"default":69',
    '"default":71',
    'XL = TECH PACK ANCHOR'
  ]) {
    if (!sizeGuide.includes(marker)) {
      failures.push(`Edition 01 tech-pack grading failure: missing marker ${marker}.`);
    }
  }
}

const themeLayout = fs.readFileSync('layout/theme.liquid', 'utf8');
const robotsSnippet = fs.readFileSync('snippets/pham-robots.liquid', 'utf8');

if (!themeLayout.includes("render 'pham-robots'")) {
  failures.push('PHAM robots policy failure: layout/theme.liquid must render pham-robots.');
}
for (const privateRoute of [
  '/pages/provenance',
  '/pages/reservation-status',
  '/pages/object-identity',
  '/pages/referral',
  '/pages/standby'
]) {
  if (!robotsSnippet.includes(privateRoute)) {
    failures.push(`PHAM robots policy failure: missing private route ${privateRoute}.`);
  }
}
if (!robotsSnippet.includes('noindex') || !robotsSnippet.includes('nofollow')) {
  failures.push('PHAM robots policy failure: provenance protection must emit noindex,nofollow.');
}

const publicCampaignApi = fs.readFileSync('backend/worker.js', 'utf8');
const publicCampaignRuntime = fs.readFileSync('assets/pham-campaign.js', 'utf8');
const publicEditionPage = fs.readFileSync('sections/pham-edition-campaign.liquid', 'utf8');
const publicProvenancePage = fs.readFileSync('sections/pham-provenance-record.liquid', 'utf8');

for (const [file, source, marker] of [
  ['backend/worker.js', publicCampaignApi, 'productionOrigin:'],
  ['assets/pham-campaign.js', publicCampaignRuntime, 'productionOrigin'],
  ['sections/pham-edition-campaign.liquid', publicEditionPage, 'Production origin'],
  ['sections/pham-provenance-record.liquid', publicProvenancePage, 'Production origin'],
  ['sections/pham-edition-campaign.liquid', publicEditionPage, 'DONGGUAN'],
  ['sections/pham-provenance-record.liquid', publicProvenancePage, 'DONGGUAN']
]) {
  if (source.includes(marker)) {
    failures.push(`Public provenance privacy failure: ${file} still exposes "${marker}".`);
  }
}

if (schemaRaw.includes('pham_campaign_production_origin_label') || raw.includes('pham_campaign_production_origin_label')) {
  failures.push('Public provenance privacy failure: production origin must not be configurable as storefront copy.');
}

const productTemplate = fs.readFileSync('templates/product.json', 'utf8');
const productMain = fs.readFileSync('sections/pham-product-main.liquid', 'utf8');
const productFocus = fs.readFileSync('sections/pham-product-focus.liquid', 'utf8');
const productCta = fs.readFileSync('snippets/pham-product-purchase-cta.liquid', 'utf8');

const staleProductCopy = [
  ['templates/product.json', productTemplate, 'Complimentary worldwide express shipping'],
  ['templates/product.json', productTemplate, 'pre-order access opens'],
  ['templates/product.json', productTemplate, 'JOIN THE WAITLIST'],
  ['sections/pham-product-main.liquid', productMain, 'Complimentary worldwide express shipping'],
  ['sections/pham-product-focus.liquid', productFocus, 'SECURE PRE-ORDER']
];

for (const [file, source, phrase] of staleProductCopy) {
  if (source.includes(phrase)) {
    failures.push(`PHAM product access copy failure: ${file} still contains "${phrase}".`);
  }
}

if (!productCta.includes("when 'prelaunch'") || !productCta.includes("EDITION 01 · ACCESS SOON")) {
  failures.push('PHAM product access copy failure: prelaunch campaign CTA must stay inside the Edition protocol.');
}

const enabled = s.pham_campaign_enabled === true;
const commerceReady = s.pham_campaign_commerce_ready === true;
const includeLookbook = s.pham_campaign_include_digital_lookbook === true;
const lookbookReady = s.pham_campaign_lookbook_ready === true;
const engineEnabled = s.pham_campaign_engine_enabled === true;
const engineProxyPath = String(s.pham_campaign_engine_proxy_path || '').trim();
const configuredSizes = String(s.pham_campaign_size_options || 'M,L,XL,XXL')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const uniqueConfiguredSizes = new Set(configuredSizes.map(value => value.toLowerCase()));

function integerSetting(key, fallback) {
  const value = Number(s[key] ?? fallback);
  return Number.isInteger(value) ? value : NaN;
}

const editionSize = integerSetting('pham_campaign_edition_size', 50);
const reservationsClaimed = integerSetting('pham_campaign_reservations_claimed', 0);
const standbyCount = integerSetting('pham_campaign_standby_count', 0);
const paymentWindowHours = integerSetting('pham_campaign_payment_window_hours', 72);
const standbyWindowHours = integerSetting('pham_campaign_standby_window_hours', 48);

if (!Number.isInteger(editionSize) || editionSize < 1 || editionSize > 500) {
  failures.push('Edition size must be a whole number from 1 to 500.');
}
if (!Number.isInteger(reservationsClaimed) || reservationsClaimed < 0 || (Number.isInteger(editionSize) && reservationsClaimed > editionSize)) {
  failures.push('Reservations claimed must be a whole number from 0 to the edition size.');
}
if (!Number.isInteger(standbyCount) || standbyCount < 0) {
  failures.push('Standby count must be a non-negative whole number.');
}
if (!Number.isInteger(paymentWindowHours) || paymentWindowHours < 1 || paymentWindowHours > 168) {
  failures.push('Reserved payment window must be a whole number from 1 to 168 hours.');
}
if (!Number.isInteger(standbyWindowHours) || standbyWindowHours < 1 || standbyWindowHours > 168) {
  failures.push('Standby payment window must be a whole number from 1 to 168 hours.');
}

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
