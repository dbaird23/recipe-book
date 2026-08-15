// One-time Cloudflare setup: create the D1 database and R2 bucket, write the
// database id into wrangler.jsonc, and apply migrations.
// Run `npx wrangler login` first, then `npm run setup -w worker`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const configPath = path.join(root, 'wrangler.jsonc');

const wrangler = (args, opts = {}) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'], ...opts });

function tryWrangler(args, label) {
  try {
    return wrangler(args);
  } catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    if (/already exists/i.test(out)) {
      console.log(`• ${label} already exists — reusing it`);
      return out;
    }
    console.error(out || e.message);
    throw new Error(`Failed to create ${label}`);
  }
}

console.log('Creating D1 database "recipe-book"…');
const d1Out = tryWrangler(['d1', 'create', 'recipe-book'], 'D1 database');

let dbId = /"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"/i.exec(d1Out)?.[1];
if (!dbId) {
  // Already existed — look it up in the account's database list
  const list = JSON.parse(wrangler(['d1', 'list', '--json']));
  dbId = list.find((d) => d.name === 'recipe-book')?.uuid;
}
if (!dbId) throw new Error('Could not determine the D1 database id — check `npx wrangler d1 list`');

const config = readFileSync(configPath, 'utf8');
const updated = config.replace(/"database_id":\s*"[^"]*"/, `"database_id": "${dbId}"`);
if (updated !== config) {
  writeFileSync(configPath, updated);
  console.log(`• Wrote database_id ${dbId} into wrangler.jsonc`);
}

console.log('Creating R2 bucket "recipe-book-photos"…');
tryWrangler(['r2', 'bucket', 'create', 'recipe-book-photos'], 'R2 bucket');

console.log('Applying migrations…');
wrangler(['d1', 'migrations', 'apply', 'recipe-book', '--remote'], { stdio: 'inherit' });

console.log('\nSetup complete. Next: npm run deploy');
