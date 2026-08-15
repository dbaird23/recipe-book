import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { db, areFriends, friendIdsOf, pairKey } from './db.js';
import {
  devLoginEnabled,
  googleEnabled,
  verifyGoogleCredential,
  findOrCreateUser,
  createSession,
  setSessionCookie,
  requireAuth,
  destroySession,
} from './auth.js';
import { importFromUrl } from './importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' }[file.mimetype];
      cb(ext ? null : new Error('Images only (jpeg, png, webp, gif)'), crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/uploads', express.static(uploadsDir));

const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const PORT = +(process.env.API_PORT || 3001);

// ---------- helpers ----------

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function autoNut(ingCount, _servings) {
  // Same placeholder heuristic as the design prototype — scales with ingredient count.
  const n = ingCount;
  return { cal: 160 + n * 38, pro: 4 + n * 4, carb: 10 + n * 5, fat: 4 + n * 3 };
}

function userPublic(u) {
  return { id: u.id, name: u.name, email: u.email, avatarUrl: u.avatar_url, isAdmin: !!u.is_admin };
}

function recipeJson(row) {
  const photos = db.prepare('SELECT id,url,position FROM photos WHERE recipe_id=? ORDER BY position,id').all(row.id);
  const comments = db
    .prepare(
      `SELECT c.id, c.text, c.photo_url, c.created_at, u.id AS author_id, u.name AS author_name, u.avatar_url AS author_avatar
       FROM comments c JOIN users u ON u.id=c.author_id WHERE c.recipe_id=? ORDER BY c.created_at,c.id`
    )
    .all(row.id);
  const owner = db.prepare('SELECT id,name FROM users WHERE id=?').get(row.owner_id);
  return {
    id: row.id,
    ownerId: row.owner_id,
    ownerName: owner?.name || '',
    title: row.title,
    prep: row.prep,
    cook: row.cook,
    servings: row.servings,
    tags: JSON.parse(row.tags),
    ing: JSON.parse(row.ing),
    dir: JSON.parse(row.dir),
    notes: row.notes,
    source: row.source,
    from: row.from_name,
    nut: JSON.parse(row.nut),
    nutEdited: !!row.nut_edited,
    createdAt: row.created_at,
    photos,
    comments: comments.map((c) => ({
      id: c.id,
      text: c.text,
      photoUrl: c.photo_url,
      createdAt: c.created_at,
      author: { id: c.author_id, name: c.author_name, avatarUrl: c.author_avatar },
    })),
  };
}

function getVisibleRecipe(req, res) {
  const row = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!row) {
    res.status(404).json({ error: 'Recipe not found' });
    return null;
  }
  if (row.owner_id !== req.user.id && !areFriends(row.owner_id, req.user.id)) {
    res.status(403).json({ error: 'This recipe belongs to someone outside your book' });
    return null;
  }
  return row;
}

function sanitizeRecipeInput(body) {
  const clean = (v) => String(v ?? '').trim();
  const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
  const nut = body.nut && typeof body.nut === 'object' ? body.nut : null;
  return {
    title: clean(body.title),
    prep: Math.max(0, +body.prep || 0),
    cook: Math.max(0, +body.cook || 0),
    servings: Math.max(1, +body.servings || 1),
    tags: list(body.tags),
    ing: list(body.ing),
    dir: list(body.dir),
    notes: clean(body.notes),
    source: clean(body.source) || null,
    nut: nut
      ? { cal: +nut.cal || 0, pro: +nut.pro || 0, carb: +nut.carb || 0, fat: +nut.fat || 0 }
      : null,
  };
}

// ---------- config & auth ----------

app.get('/api/config', (_req, res) => {
  res.json({
    googleEnabled: googleEnabled(),
    devLoginEnabled: devLoginEnabled(),
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
  });
});

app.post(
  '/api/auth/google',
  asyncRoute(async (req, res) => {
    const identity = await verifyGoogleCredential(req.body.credential);
    const { user } = findOrCreateUser({ ...identity, inviteToken: req.body.inviteToken });
    setSessionCookie(res, createSession(user.id));
    res.json({ user: userPublic(user) });
  })
);

app.post('/api/auth/dev', (req, res) => {
  if (!devLoginEnabled()) return res.status(403).json({ error: 'Dev sign-in is disabled' });
  const email = String(req.body.email || '').trim().toLowerCase();
  const name = String(req.body.name || '').trim() || email.split('@')[0];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
  const { user } = findOrCreateUser({ sub: null, email, name, picture: null, inviteToken: req.body.inviteToken });
  setSessionCookie(res, createSession(user.id));
  res.json({ user: userPublic(user) });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: userPublic(req.user) }));

app.patch('/api/me', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name can’t be empty' });
  db.prepare('UPDATE users SET name=? WHERE id=?').run(name, req.user.id);
  res.json({ user: userPublic({ ...req.user, name }) });
});

app.post('/api/me/avatar', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE users SET avatar_url=? WHERE id=?').run(url, req.user.id);
  res.json({ avatarUrl: url });
});

app.delete('/api/me/avatar', requireAuth, (req, res) => {
  db.prepare('UPDATE users SET avatar_url=NULL WHERE id=?').run(req.user.id);
  res.json({ ok: true });
});

// ---------- invites ----------

app.post('/api/invites', requireAuth, (req, res) => {
  if (!req.user.is_admin) return res.status(403).json({ error: 'Only the group admin can invite new members' });
  const token = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO invites (token,created_by,phone) VALUES (?,?,?)').run(
    token,
    req.user.id,
    String(req.body.phone || '').trim() || null
  );
  res.json({ token, url: `${APP_URL}/invite/${token}` });
});

app.get('/api/invites/:token', (req, res) => {
  const row = db
    .prepare('SELECT i.used_by, u.name AS inviter FROM invites i JOIN users u ON u.id=i.created_by WHERE i.token=?')
    .get(req.params.token);
  if (!row) return res.status(404).json({ error: 'That invite link isn’t valid' });
  if (row.used_by) return res.status(410).json({ error: 'That invite link was already used' });
  res.json({ inviter: row.inviter });
});

// ---------- recipes ----------

app.get('/api/recipes', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM recipes WHERE owner_id=? ORDER BY created_at DESC, rowid DESC').all(req.user.id);
  res.json({ recipes: rows.map(recipeJson) });
});

app.post('/api/recipes', requireAuth, (req, res) => {
  const r = sanitizeRecipeInput(req.body);
  if (!r.title) return res.status(400).json({ error: 'Give it a title' });
  const id = crypto.randomUUID();
  const nut = r.nut || autoNut(r.ing.length, r.servings);
  db.prepare(
    `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,nut,nut_edited)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`
  ).run(
    id, req.user.id, r.title, r.prep, r.cook, r.servings,
    JSON.stringify(r.tags), JSON.stringify(r.ing), JSON.stringify(r.dir),
    r.notes, r.source, JSON.stringify(nut)
  );
  const urls = Array.isArray(req.body.photoUrls) ? req.body.photoUrls.slice(0, 8) : [];
  const ins = db.prepare('INSERT INTO photos (id,recipe_id,url,position) VALUES (?,?,?,?)');
  urls.forEach((u, i) => {
    if (typeof u === 'string' && /^(https?:\/\/|\/uploads\/)/.test(u)) ins.run(crypto.randomUUID(), id, u, i);
  });
  res.json({ recipe: recipeJson(db.prepare('SELECT * FROM recipes WHERE id=?').get(id)) });
});

app.get('/api/recipes/:id', requireAuth, (req, res) => {
  const row = getVisibleRecipe(req, res);
  if (row) res.json({ recipe: recipeJson(row) });
});

app.patch('/api/recipes/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can edit a recipe' });

  if (req.body.nut && Object.keys(req.body).length <= 2) {
    // Nutrition-only adjustment (with optional nutEdited flag)
    const n = req.body.nut;
    const nut = { cal: +n.cal || 0, pro: +n.pro || 0, carb: +n.carb || 0, fat: +n.fat || 0 };
    db.prepare("UPDATE recipes SET nut=?, nut_edited=?, updated_at=datetime('now') WHERE id=?").run(
      JSON.stringify(nut), req.body.nutEdited === false ? 0 : 1, row.id
    );
  } else if (typeof req.body.notes === 'string' && Object.keys(req.body).length === 1) {
    db.prepare("UPDATE recipes SET notes=?, updated_at=datetime('now') WHERE id=?").run(req.body.notes.trim(), row.id);
  } else {
    const r = sanitizeRecipeInput(req.body);
    if (!r.title) return res.status(400).json({ error: 'Give it a title' });
    const keepNut = row.nut_edited ? JSON.parse(row.nut) : autoNut(r.ing.length, r.servings);
    db.prepare(
      `UPDATE recipes SET title=?,prep=?,cook=?,servings=?,tags=?,ing=?,dir=?,notes=?,source=?,nut=?,updated_at=datetime('now') WHERE id=?`
    ).run(
      r.title, r.prep, r.cook, r.servings,
      JSON.stringify(r.tags), JSON.stringify(r.ing), JSON.stringify(r.dir),
      r.notes, r.source ?? row.source, JSON.stringify(keepNut), row.id
    );
  }
  res.json({ recipe: recipeJson(db.prepare('SELECT * FROM recipes WHERE id=?').get(row.id)) });
});

app.delete('/api/recipes/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can delete a recipe' });
  db.prepare('DELETE FROM recipes WHERE id=?').run(row.id);
  res.json({ ok: true });
});

// Save a friend's recipe into my book (deep copy — later edits to theirs never touch mine)
app.post('/api/recipes/:id/save', requireAuth, (req, res) => {
  const row = getVisibleRecipe(req, res);
  if (!row) return;
  if (row.owner_id === req.user.id) return res.status(400).json({ error: 'That one’s already yours' });
  const owner = db.prepare('SELECT name FROM users WHERE id=?').get(row.owner_id);
  const id = crypto.randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,from_name,nut,nut_edited)
       SELECT ?, ?, title,prep,cook,servings,tags,ing,dir,notes,source, ?, nut,nut_edited FROM recipes WHERE id=?`
    ).run(id, req.user.id, owner.name, row.id);
    const photos = db.prepare('SELECT url,position FROM photos WHERE recipe_id=?').all(row.id);
    const ins = db.prepare('INSERT INTO photos (id,recipe_id,url,position) VALUES (?,?,?,?)');
    for (const p of photos) ins.run(crypto.randomUUID(), id, p.url, p.position);
  });
  tx();
  res.json({ recipe: recipeJson(db.prepare('SELECT * FROM recipes WHERE id=?').get(id)) });
});

app.post('/api/recipes/:id/comments', requireAuth, upload.single('photo'), (req, res) => {
  const row = getVisibleRecipe(req, res);
  if (!row) return;
  const text = String(req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Write something first' });
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO comments (id,recipe_id,author_id,text,photo_url) VALUES (?,?,?,?,?)').run(
    id, row.id, req.user.id, text, req.file ? '/uploads/' + req.file.filename : null
  );
  res.json({ recipe: recipeJson(row) });
});

app.post('/api/recipes/:id/photos', requireAuth, upload.single('photo'), (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can add photos' });
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const pos = db.prepare('SELECT COALESCE(MAX(position)+1,0) AS p FROM photos WHERE recipe_id=?').get(row.id).p;
  db.prepare('INSERT INTO photos (id,recipe_id,url,position) VALUES (?,?,?,?)').run(
    crypto.randomUUID(), row.id, '/uploads/' + req.file.filename, pos
  );
  res.json({ recipe: recipeJson(row) });
});

app.delete('/api/recipes/:id/photos/:photoId', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM recipes WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Recipe not found' });
  if (row.owner_id !== req.user.id) return res.status(403).json({ error: 'Only the owner can remove photos' });
  db.prepare('DELETE FROM photos WHERE id=? AND recipe_id=?').run(req.params.photoId, row.id);
  res.json({ recipe: recipeJson(row) });
});

// ---------- friends ----------

app.get('/api/friends', requireAuth, (req, res) => {
  const ids = friendIdsOf(req.user.id);
  const friends = ids.map((id) => {
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
    const count = db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE owner_id=?').get(id).n;
    return { ...userPublic(u), recipeCount: count };
  });
  friends.sort((a, b) => a.name.localeCompare(b.name));
  res.json({ friends });
});

app.get('/api/friends/recipes', requireAuth, (req, res) => {
  const ids = friendIdsOf(req.user.id);
  const recipes = ids.flatMap((id) =>
    db.prepare('SELECT * FROM recipes WHERE owner_id=? ORDER BY created_at DESC, rowid DESC').all(id).map(recipeJson)
  );
  res.json({ recipes });
});

app.get('/api/friends/:id/recipes', requireAuth, (req, res) => {
  if (!areFriends(req.user.id, req.params.id)) return res.status(403).json({ error: 'Not in your friends' });
  const rows = db.prepare('SELECT * FROM recipes WHERE owner_id=? ORDER BY created_at DESC, rowid DESC').all(req.params.id);
  res.json({ recipes: rows.map(recipeJson) });
});

app.delete('/api/friends/:id', requireAuth, (req, res) => {
  const [a, b] = pairKey(req.user.id, req.params.id);
  const info = db.prepare('DELETE FROM friendships WHERE user_a=? AND user_b=?').run(a, b);
  if (!info.changes) return res.status(404).json({ error: 'Not in your friends' });
  res.json({ ok: true });
});

// ---------- import ----------

app.post(
  '/api/import',
  requireAuth,
  asyncRoute(async (req, res) => {
    const url = String(req.body.url || '').trim();
    if (!url) return res.status(400).json({ error: 'Paste a recipe link first' });
    res.json({ draft: await importFromUrl(url) });
  })
);

// ---------- static (production) & errors ----------

const distDir = path.join(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^\/(?!api\/|uploads\/).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((err, _req, res, _next) => {
  const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Something went wrong' });
});

app.listen(PORT, () => console.log(`Recipe Book API on http://localhost:${PORT}`));
