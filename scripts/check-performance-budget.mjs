import fs from 'node:fs';

const failures = [];

function bytes(path) {
  return fs.statSync(path).size;
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const budgets = [
  ['assets/pham-vault.js', 45_000],
  ['assets/pham-vault.css', 46_000],
  ['assets/pham-campaign.js', 50_000],
  ['assets/pham-cart.js', 27_000],
  ['assets/pham-animations.js', 25_000],
  ['assets/pham-lookbook.js', 31_000],
  ['assets/pham-product-stage.js', 18_000],
];

for (const [path, max] of budgets) {
  const size = bytes(path);
  assert(size <= max, `${path} is ${size} B; budget is ${max} B.`);
}

const productTemplate = fs.readFileSync('templates/product.json', 'utf8');
assert(
  productTemplate.includes('"default_view": "image"'),
  'PHAM product viewer must default to IMAGE so the 3D model is user-initiated.'
);
assert(
  productTemplate.includes('PHAM-optimized-4096-j90-v3.glb') &&
    !productTemplate.includes('/9151f5eebff102c8/PHAM.glb'),
  'PHAM product viewer must keep the optimized 3D model instead of the legacy 10 MB GLB.'
);

const productStage = fs.readFileSync('sections/pham-product-3d.liquid', 'utf8');
assert(
  !productStage.includes("'pham-vault.css'"),
  'PHAM product 3D section must not load pham-vault.css.'
);

const vault = fs.readFileSync('assets/pham-vault.js', 'utf8');
assert(
  vault.includes("IntersectionObserver"),
  'PHAM Vault must keep its viewport activity guard.'
);

const modelStage = fs.readFileSync('assets/pham-product-stage.js', 'utf8');
assert(
  modelStage.includes("requestIdleCallback") && modelStage.includes("IntersectionObserver"),
  'PHAM 3D model loading must remain deferred and viewport-aware.'
);

if (failures.length) {
  console.error('PHAM performance budget failed:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('PHAM performance budget passed.');
for (const [path, max] of budgets) {
  console.log(`- ${path}: ${bytes(path)} / ${max} B`);
}
