/**
 * PHAM static asset budget and image-first product gallery checks.
 * These are repository guardrails, not lab/field Core Web Vitals measurements.
 */
import fs from 'node:fs';

const failures = [];
const results = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}
const budgets = [
  ['assets/pham-vault.js', 53_000],
  ['assets/pham-vault.css', 53_000],
  ['assets/pham-campaign.js', 52_000],
  ['assets/pham-cart.js', 27_000],
  ['assets/pham-animations.js', 30_000],
  ['assets/pham-lookbook.js', 32_000],
  ['assets/pham-interactions.js', 8_000],
  ['assets/pham-immersive.js', 8_000],
];
for (const [path, maxBytes] of budgets) {
  if (!fs.existsSync(path)) {
    failures.push('Required storefront asset missing: ' + path);
    continue;
  }
  const actualBytes = fs.statSync(path).size;
  results.push({path, actualBytes, maxBytes});
  assert(actualBytes <= maxBytes,
    path + ' is ' + actualBytes + ' bytes; budget is ' + maxBytes + ' bytes.');
}

for (const path of [
  'templates/product.json',
  'sections/pham-product-main.liquid',
  'snippets/pham-product-gallery.liquid',
  'assets/pham-vault.js'
]) {
  if (!fs.existsSync(path)) failures.push('Required image-first section missing: ' + path);
}
if (!failures.some(x => x.includes('Required image-first'))) {
  const productTemplate = fs.readFileSync('templates/product.json', 'utf8');
  const productMain = fs.readFileSync('sections/pham-product-main.liquid', 'utf8');
  const gallery = fs.readFileSync('snippets/pham-product-gallery.liquid', 'utf8');
  const vault = fs.readFileSync('assets/pham-vault.js', 'utf8');
  assert(productTemplate.includes('"type": "pham-product-main"'),
    'PHAM-001 product must use the image-first product section.');
  const editorialImageCount = (productTemplate.match(/"type": "gallery_image"/g) || []).length;
  assert(editorialImageCount >= 3, 'PHAM-001 product must include at least 3 editorial gallery images.');
  assert(!/\.glb\b|pham-product-3d|product-stage\.js/i.test(productTemplate),
    'PHAM-001 product template must not silently re-enable the removed 3D model.');
  assert(productMain.includes("render 'pham-product-gallery'"),
    'PHAM-001 page must render the editorial image gallery.');
  assert(gallery.includes('image_url') || gallery.includes('image_tag'),
    'PHAM product gallery must render Shopify-optimized image URLs.');
  assert(vault.includes('IntersectionObserver'),
    'PHAM Vault must retain its viewport activity guard.');
}

if (failures.length) {
  console.error('PHAM performance budget failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}
console.log('PHAM image-first static performance guardrails passed. (Not Core Web Vitals.)');
for (const {path,actualBytes,maxBytes} of results) {
  console.log('- ' + path + ': ' + actualBytes + ' / ' + maxBytes + ' B');
}
