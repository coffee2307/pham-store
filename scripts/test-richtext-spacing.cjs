'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const helper = read('snippets/pham-richtext-plain.liquid');
const replacements = [...helper.matchAll(/\|\s*replace:\s*'([^']+)',\s*'([^']*)'/g)]
  .map((m) => [m[1], m[2]]);
assert.ok(replacements.length >= 17, 'Expected HTML boundary and whitespace replacements');
assert.ok(helper.includes('| strip_html'), 'Must remove markup after protecting boundary spaces');

function plainFromHtml(html) {
  let result = html;
  for (const [from, to] of replacements) result = result.split(from).join(to);
  return result.replace(/<[^>]*>/g, '').trim();
}

const examples = [
  ['<p>insulation.</p><p><strong>Edition 01:</strong> 50 numbered jackets. No restock after closure.</p><p>Designed in Vietnam.</p>',
   'insulation. Edition 01: 50 numbered jackets. No restock after closure. Designed in Vietnam.'],
  ['<p>insulation.</p> <p>Edition 01: 50 numbered jackets.</p> <p>Designed in Vietnam.</p>',
   'insulation. Edition 01: 50 numbered jackets. Designed in Vietnam.'],
  ['<ul><li>First.</li><li>Second.</li></ul>', 'First. Second.'],
  ['<p>First.<br>Second.<br/>Third.<br />Fourth.</p>', 'First. Second. Third. Fourth.'],
  ['<h2>Title.</h2><p>Body &nbsp; text.</p>', 'Title. Body text.'],
];
for (const [source, expected] of examples) {
  assert.equal(plainFromHtml(source), expected);
}

const audited = [
  'sections/pham-product-spotlight.liquid',
  'sections/pham-product-focus.liquid',
  'sections/pham-blog-grid.liquid',
  'blocks/_blog-post-description.liquid',
  'snippets/resource-card.liquid',
  'snippets/pham-seo-description.liquid',
  'snippets/meta-tags.liquid',
  'snippets/pham-structured-data.liquid',
  'sections/pham-article.liquid',
  'blocks/_announcement.liquid',
];
for (const rel of audited) {
  const source = read(rel);
  assert.ok(source.includes("render 'pham-richtext-plain'"), rel + ': converter not applied');
}
const spotlight = read('sections/pham-product-spotlight.liquid');
assert.ok(!spotlight.includes('product.description | strip_html'), 'Old concatenating conversion remains');
const focus = read('sections/pham-product-focus.liquid');
assert.ok(!focus.includes('focus_product.description | strip_html'), 'Old concatenating conversion remains');

console.log('PASS: ' + examples.length + ' conversion cases; ' + audited.length + ' theme integration files');
