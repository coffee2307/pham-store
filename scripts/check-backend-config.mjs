import fs from 'node:fs';

const wranglerPath = 'backend/wrangler.toml';
const raw = fs.readFileSync(wranglerPath, 'utf8');

const failures = [];
function assert(condition, message) {
  if (!condition) failures.push(message);
}

assert(
  !raw.includes('REPLACE_WITH_D1_DATABASE_ID'),
  'backend/wrangler.toml still contains the placeholder D1 database id.'
);

const idMatch = raw.match(/database_id\s*=\s*"([^"]+)"/);
assert(Boolean(idMatch), 'backend/wrangler.toml must declare a D1 database_id.');

if (idMatch) {
  assert(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idMatch[1]),
    'backend/wrangler.toml database_id must be a valid UUID.'
  );
}

assert(
  raw.includes('binding = "PHAM_CAMPAIGN_DB"'),
  'backend/wrangler.toml must keep the PHAM_CAMPAIGN_DB binding.'
);

assert(
  raw.includes('migrations_dir = "migrations"'),
  'backend/wrangler.toml must keep migrations_dir = "migrations".'
);

if (failures.length) {
  console.error('PHAM backend config safety failed:');
  failures.forEach((message) => console.error('- ' + message));
  process.exit(1);
}

console.log('PHAM backend config safety passed.');
