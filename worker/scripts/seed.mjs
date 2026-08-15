// Seed demo data (the three demo friends and starter recipes) into D1.
// Sign in once first so an admin account exists, then:
//   npm run seed -w worker            # local dev database
//   npm run seed -w worker -- --remote
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DEMO_MY_RECIPES, DEMO_FRIENDS } from '../../web/src/demoData.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const remote = process.argv.includes('--remote');
const target = remote ? '--remote' : '--local';

const wrangler = (args) =>
  execFileSync('npx', ['wrangler', ...args], { cwd: root, encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] });

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();

function queryOne(sql) {
  const out = wrangler(['d1', 'execute', 'recipe-book', target, '--json', '--command', sql]);
  const parsed = JSON.parse(out.slice(out.indexOf('[')));
  return parsed[0]?.results?.[0] || null;
}

const me = queryOne("SELECT id, name FROM users WHERE is_admin=1 ORDER BY created_at LIMIT 1");
if (!me) {
  console.error('No account found yet. Start the app, sign in once, then run this again.');
  process.exit(1);
}
if (queryOne("SELECT id FROM users WHERE email='betsy@example.com'")) {
  console.log('Demo data already seeded.');
  process.exit(0);
}

const lines = [];
const friendIds = {};
const authorId = { You: me.id, [me.name]: me.id };

for (const f of DEMO_FRIENDS) {
  const id = randomUUID();
  friendIds[f.name] = id;
  authorId[f.name] = id;
  lines.push(
    `INSERT INTO users (id,email,name,is_admin,created_at) VALUES (${q(id)},${q(
      f.name.toLowerCase() + '@example.com'
    )},${q(f.name)},0,${q(now)});`
  );
}

const everyone = [me.id, ...Object.values(friendIds)];
for (const a of everyone) {
  for (const b of everyone) {
    if (a < b) {
      lines.push(`INSERT OR IGNORE INTO friendships (user_a,user_b,created_at) VALUES (${q(a)},${q(b)},${q(now)});`);
    }
  }
}

function addRecipe(ownerId, r) {
  const id = randomUUID();
  lines.push(
    `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,from_name,nut,nut_edited,created_at,updated_at) VALUES (` +
      [
        q(id), q(ownerId), q(r.title), r.prep || 0, r.cook || 0, r.servings || 1,
        q(JSON.stringify(r.tags || [])), q(JSON.stringify(r.ing || [])), q(JSON.stringify(r.dir || [])),
        q(r.notes || ''), q(r.source || null), q(r.from || null), q(JSON.stringify(r.nut)), 0, q(now), q(now),
      ].join(',') +
      `);`
  );
  for (const c of r.comments || []) {
    const author = authorId[c.author];
    if (!author) continue;
    lines.push(
      `INSERT INTO comments (id,recipe_id,author_id,text,created_at) VALUES (${q(randomUUID())},${q(id)},${q(
        author
      )},${q(c.text)},${q(now)});`
    );
  }
}

for (const r of DEMO_MY_RECIPES) addRecipe(me.id, r);
for (const f of DEMO_FRIENDS) for (const r of f.recipes) addRecipe(friendIds[f.name], r);

const file = path.join(mkdtempSync(path.join(tmpdir(), 'rb-seed-')), 'seed.sql');
writeFileSync(file, lines.join('\n'));
wrangler(['d1', 'execute', 'recipe-book', target, '--file', file]);

console.log(`Seeded demo friends (Betsy, Hannah, Emily) and starter recipes for ${me.name} (${target}).`);
