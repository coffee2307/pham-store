import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = [
  'src/domain',
  'src/services',
  'src/adapters',
  'src/shopify',
  'src/http'
];

const files = roots.flatMap((dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => join(dir, entry.name))
);

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`Edition Engine syntax check passed for ${files.length} file(s).`);
