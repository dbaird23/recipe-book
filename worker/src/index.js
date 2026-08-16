import {
  verifyGoogleCredential,
  findOrCreateUser,
  createSession,
  sessionCookie,
  clearCookie,
  readCookie,
  currentUser,
} from './auth.js';
import { importFromUrl } from './importer.js';
import { HttpError, uid, nowIso, pairKey, json, autoNut, sanitizeRecipeInput, putImage, photoUrl } from './util.js';

// ---------- tiny router ----------

const routes = [];
const on = (method, pattern, handler) => routes.push({ method, pattern: new URLPattern({ pathname: pattern }), handler });
const get = (p, h) => on('GET', p, h);
const post = (p, h) => on('POST', p, h);
const patch = (p, h) => on('PATCH', p, h);
const del = (p, h) => on('DELETE', p, h);

// ---------- helpers ----------

const userPublic = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatar_key ? photoUrl(u.avatar_key) : null,
  isAdmin: !!u.is_admin,
});

function requireUser(ctx) {
  if (!ctx.user) throw new HttpError(401, 'Not signed in');
  return ctx.user;
}

function requireAdmin(ctx) {
  const u = requireUser(ctx);
  if (!u.is_admin) throw new HttpError(403, 'Only the group admin can invite new members');
  return u;
}

async function recipeJson(db, row) {
  const [photos, comments, owner] = await Promise.all([
    db.prepare('SELECT id,key,position FROM photos WHERE recipe_id=? ORDER BY position,id').bind(row.id).all(),
    db
      .prepare(
        `SELECT c.id, c.text, c.photo_key, c.created_at, u.id AS author_id, u.name AS author_name, u.avatar_key AS author_avatar
         FROM comments c JOIN users u ON u.id=c.author_id WHERE c.recipe_id=? ORDER BY c.created_at,c.id`
      )
      .bind(row.id)
      .all(),
    db.prepare('SELECT name FROM users WHERE id=?').bind(row.owner_id).first(),
  ]);
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
    rating: row.rating || 0,
    createdAt: row.created_at,
    photos: photos.results.map((p) => ({ id: p.id, url: photoUrl(p.key), position: p.position })),
    comments: comments.results.map((c) => ({
      id: c.id,
      text: c.text,
      photoUrl: c.photo_key ? photoUrl(c.photo_key) : null,
      createdAt: c.created_at,
      author: {
        id: c.author_id,
        name: c.author_name,
        avatarUrl: c.author_avatar ? photoUrl(c.author_avatar) : null,
      },
    })),
  };
}

async function areFriends(db, a, b) {
  const [x, y] = pairKey(a, b);
  return !!(await db.prepare('SELECT 1 FROM friendships WHERE user_a=? AND user_b=?').bind(x, y).first());
}

async function friendIdsOf(db, userId) {
  const { results } = await db
    .prepare('SELECT user_a, user_b FROM friendships WHERE user_a=? OR user_b=?')
    .bind(userId, userId)
    .all();
  return results.map((r) => (r.user_a === userId ? r.user_b : r.user_a));
}

async function loadRecipe(db, id) {
  const row = await db.prepare('SELECT * FROM recipes WHERE id=?').bind(id).first();
  if (!row) throw new HttpError(404, 'Recipe not found');
  return row;
}

async function loadVisibleRecipe(ctx, id) {
  const me = requireUser(ctx);
  const row = await loadRecipe(ctx.db, id);
  if (row.owner_id !== me.id && !(await areFriends(ctx.db, row.owner_id, me.id))) {
    throw new HttpError(403, 'This recipe belongs to someone outside your book');
  }
  return row;
}

async function loadOwnedRecipe(ctx, id, what = 'edit a recipe') {
  const me = requireUser(ctx);
  const row = await loadRecipe(ctx.db, id);
  if (row.owner_id !== me.id) throw new HttpError(403, `Only the owner can ${what}`);
  return row;
}

// ---------- config & auth ----------

get('/api/config', (ctx) =>
  json({
    googleEnabled: !!ctx.env.GOOGLE_CLIENT_ID,
    devLoginEnabled: !ctx.env.GOOGLE_CLIENT_ID,
    googleClientId: ctx.env.GOOGLE_CLIENT_ID || null,
  })
);

async function signIn(ctx, user) {
  const token = await createSession(ctx.db, user.id);
  return json({ user: userPublic(user) }, { headers: { 'set-cookie': sessionCookie(token, ctx.secure) } });
}

post('/api/auth/google', async (ctx) => {
  const body = await ctx.json();
  const identity = await verifyGoogleCredential(body.credential, ctx.env.GOOGLE_CLIENT_ID);
  const user = await findOrCreateUser(ctx.db, { ...identity, inviteToken: body.inviteToken });
  return signIn(ctx, user);
});

post('/api/auth/dev', async (ctx) => {
  if (ctx.env.GOOGLE_CLIENT_ID) throw new HttpError(403, 'Dev sign-in is disabled');
  const body = await ctx.json();
  const email = String(body.email || '').trim().toLowerCase();
  const name = String(body.name || '').trim() || email.split('@')[0];
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email');
  const user = await findOrCreateUser(ctx.db, { sub: null, email, name, inviteToken: body.inviteToken });
  return signIn(ctx, user);
});

post('/api/auth/logout', async (ctx) => {
  const token = readCookie(ctx.request, 'session');
  if (token) await ctx.db.prepare('DELETE FROM sessions WHERE token=?').bind(token).run();
  return json({ ok: true }, { headers: { 'set-cookie': clearCookie(ctx.secure) } });
});

get('/api/me', (ctx) => json({ user: userPublic(requireUser(ctx)) }));

patch('/api/me', async (ctx) => {
  const me = requireUser(ctx);
  const name = String((await ctx.json()).name || '').trim();
  if (!name) throw new HttpError(400, 'Name can’t be empty');
  await ctx.db.prepare('UPDATE users SET name=? WHERE id=?').bind(name, me.id).run();
  return json({ user: userPublic({ ...me, name }) });
});

post('/api/me/avatar', async (ctx) => {
  const me = requireUser(ctx);
  const form = await ctx.request.formData();
  const key = await putImage(ctx.env, form.get('photo'));
  if (me.avatar_key && !/^https?:\/\//.test(me.avatar_key)) await ctx.env.PHOTOS.delete(me.avatar_key);
  await ctx.db.prepare('UPDATE users SET avatar_key=? WHERE id=?').bind(key, me.id).run();
  return json({ avatarUrl: photoUrl(key) });
});

del('/api/me/avatar', async (ctx) => {
  const me = requireUser(ctx);
  if (me.avatar_key && !/^https?:\/\//.test(me.avatar_key)) await ctx.env.PHOTOS.delete(me.avatar_key);
  await ctx.db.prepare('UPDATE users SET avatar_key=NULL WHERE id=?').bind(me.id).run();
  return json({ ok: true });
});

// ---------- invites ----------

post('/api/invites', async (ctx) => {
  const me = requireAdmin(ctx);
  const body = await ctx.json();
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await ctx.db
    .prepare('INSERT INTO invites (token,created_by,phone,created_at) VALUES (?,?,?,?)')
    .bind(token, me.id, String(body.phone || '').trim() || null, nowIso())
    .run();
  // Prefer the browser's origin: in dev the Worker sits behind the Vite proxy
  const origin = ctx.request.headers.get('origin') || new URL(ctx.request.url).origin;
  return json({ token, url: `${origin}/invite/${token}` });
});

get('/api/invites/:token', async (ctx) => {
  const row = await ctx.db
    .prepare('SELECT i.used_by, u.name AS inviter FROM invites i JOIN users u ON u.id=i.created_by WHERE i.token=?')
    .bind(ctx.params.token)
    .first();
  if (!row) throw new HttpError(404, 'That invite link isn’t valid');
  if (row.used_by) throw new HttpError(410, 'That invite link was already used');
  return json({ inviter: row.inviter });
});

// ---------- recipes ----------

const listRecipes = async (db, ownerId) => {
  const { results } = await db
    .prepare('SELECT * FROM recipes WHERE owner_id=? ORDER BY created_at DESC, rowid DESC')
    .bind(ownerId)
    .all();
  return Promise.all(results.map((r) => recipeJson(db, r)));
};

get('/api/recipes', async (ctx) => json({ recipes: await listRecipes(ctx.db, requireUser(ctx).id) }));

post('/api/recipes', async (ctx) => {
  const me = requireUser(ctx);
  const body = await ctx.json();
  const r = sanitizeRecipeInput(body);
  if (!r.title) throw new HttpError(400, 'Give it a title');
  const id = uid();
  const now = nowIso();
  const nut = r.nut || autoNut(r.ing.length);
  const stmts = [
    ctx.db
      .prepare(
        `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,nut,nut_edited,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        id, me.id, r.title, r.prep, r.cook, r.servings,
        JSON.stringify(r.tags), JSON.stringify(r.ing), JSON.stringify(r.dir),
        // Nutrition that came from an import or paste is real data, not an
        // estimate, so mark it edited and stop the heuristic overwriting it
        r.notes, r.source, JSON.stringify(nut), r.nut ? 1 : 0, now, now
      ),
  ];
  const urls = Array.isArray(body.photoUrls) ? body.photoUrls.slice(0, 8) : [];
  urls.forEach((u, i) => {
    if (typeof u === 'string' && /^https?:\/\//.test(u)) {
      stmts.push(ctx.db.prepare('INSERT INTO photos (id,recipe_id,key,position) VALUES (?,?,?,?)').bind(uid(), id, u, i));
    }
  });
  await ctx.db.batch(stmts);
  return json({ recipe: await recipeJson(ctx.db, await loadRecipe(ctx.db, id)) });
});

get('/api/recipes/:id', async (ctx) => json({ recipe: await recipeJson(ctx.db, await loadVisibleRecipe(ctx, ctx.params.id)) }));

patch('/api/recipes/:id', async (ctx) => {
  const row = await loadOwnedRecipe(ctx, ctx.params.id);
  const body = await ctx.json();
  const now = nowIso();

  if (body.nut && Object.keys(body).length <= 2) {
    // Nutrition-only adjustment (with optional nutEdited flag)
    const n = body.nut;
    const nut = { cal: +n.cal || 0, pro: +n.pro || 0, carb: +n.carb || 0, fat: +n.fat || 0 };
    await ctx.db
      .prepare('UPDATE recipes SET nut=?, nut_edited=?, updated_at=? WHERE id=?')
      .bind(JSON.stringify(nut), body.nutEdited === false ? 0 : 1, now, row.id)
      .run();
  } else if ('rating' in body && Object.keys(body).length === 1) {
    // Only the owner rates their own recipe — loadOwnedRecipe already enforced that
    const rating = Math.round(+body.rating || 0);
    if (rating < 0 || rating > 5) throw new HttpError(400, 'Rating must be between 0 and 5 stars');
    await ctx.db.prepare('UPDATE recipes SET rating=?, updated_at=? WHERE id=?').bind(rating, now, row.id).run();
  } else if (typeof body.notes === 'string' && Object.keys(body).length === 1) {
    await ctx.db.prepare('UPDATE recipes SET notes=?, updated_at=? WHERE id=?').bind(body.notes.trim(), now, row.id).run();
  } else {
    const r = sanitizeRecipeInput(body);
    if (!r.title) throw new HttpError(400, 'Give it a title');
    const keepNut = row.nut_edited ? JSON.parse(row.nut) : autoNut(r.ing.length);
    // "Saved from …" credit: updatable (and removable) when the edit sends a `from` key
    const fromName = 'from' in body ? String(body.from || '').trim() || null : row.from_name;
    await ctx.db
      .prepare(
        `UPDATE recipes SET title=?,prep=?,cook=?,servings=?,tags=?,ing=?,dir=?,notes=?,source=?,from_name=?,nut=?,updated_at=? WHERE id=?`
      )
      .bind(
        r.title, r.prep, r.cook, r.servings,
        JSON.stringify(r.tags), JSON.stringify(r.ing), JSON.stringify(r.dir),
        r.notes, r.source ?? row.source, fromName, JSON.stringify(keepNut), now, row.id
      )
      .run();
  }
  return json({ recipe: await recipeJson(ctx.db, await loadRecipe(ctx.db, row.id)) });
});

del('/api/recipes/:id', async (ctx) => {
  const row = await loadOwnedRecipe(ctx, ctx.params.id, 'delete a recipe');
  const { results: photos } = await ctx.db.prepare('SELECT key FROM photos WHERE recipe_id=?').bind(row.id).all();
  const { results: comments } = await ctx.db
    .prepare('SELECT photo_key FROM comments WHERE recipe_id=? AND photo_key IS NOT NULL')
    .bind(row.id)
    .all();
  const keys = [...photos.map((p) => p.key), ...comments.map((c) => c.photo_key)].filter((k) => !/^https?:\/\//.test(k));
  if (keys.length) await ctx.env.PHOTOS.delete(keys);
  await ctx.db.prepare('DELETE FROM recipes WHERE id=?').bind(row.id).run();
  return json({ ok: true });
});

// Save a friend's recipe into my book — a clean copy: no tags, no comments,
// credited to them, and independent of their later edits.
post('/api/recipes/:id/save', async (ctx) => {
  const me = requireUser(ctx);
  const row = await loadVisibleRecipe(ctx, ctx.params.id);
  if (row.owner_id === me.id) throw new HttpError(400, 'That one’s already yours');
  const owner = await ctx.db.prepare('SELECT name FROM users WHERE id=?').bind(row.owner_id).first();
  const id = uid();
  const now = nowIso();
  const { results: photos } = await ctx.db
    .prepare('SELECT key,position FROM photos WHERE recipe_id=? ORDER BY position')
    .bind(row.id)
    .all();
  const stmts = [
    ctx.db
      .prepare(
        `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,from_name,nut,nut_edited,created_at,updated_at)
         SELECT ?,?,title,prep,cook,servings,'[]',ing,dir,notes,source,?,nut,nut_edited,?,? FROM recipes WHERE id=?`
      )
      .bind(id, me.id, owner.name, now, now, row.id),
    ...photos.map((p) =>
      ctx.db.prepare('INSERT INTO photos (id,recipe_id,key,position) VALUES (?,?,?,?)').bind(uid(), id, p.key, p.position)
    ),
  ];
  await ctx.db.batch(stmts);
  return json({ recipe: await recipeJson(ctx.db, await loadRecipe(ctx.db, id)) });
});

post('/api/recipes/:id/comments', async (ctx) => {
  const me = requireUser(ctx);
  const row = await loadVisibleRecipe(ctx, ctx.params.id);
  const form = await ctx.request.formData();
  const text = String(form.get('text') || '').trim();
  if (!text) throw new HttpError(400, 'Write something first');
  const file = form.get('photo');
  const key = file && typeof file.arrayBuffer === 'function' ? await putImage(ctx.env, file) : null;
  await ctx.db
    .prepare('INSERT INTO comments (id,recipe_id,author_id,text,photo_key,created_at) VALUES (?,?,?,?,?,?)')
    .bind(uid(), row.id, me.id, text, key, nowIso())
    .run();
  return json({ recipe: await recipeJson(ctx.db, row) });
});

post('/api/recipes/:id/photos', async (ctx) => {
  const row = await loadOwnedRecipe(ctx, ctx.params.id, 'add photos');
  const form = await ctx.request.formData();
  const key = await putImage(ctx.env, form.get('photo'));
  const { p } = await ctx.db
    .prepare('SELECT COALESCE(MAX(position)+1,0) AS p FROM photos WHERE recipe_id=?')
    .bind(row.id)
    .first();
  await ctx.db.prepare('INSERT INTO photos (id,recipe_id,key,position) VALUES (?,?,?,?)').bind(uid(), row.id, key, p).run();
  return json({ recipe: await recipeJson(ctx.db, row) });
});

del('/api/recipes/:id/photos/:photoId', async (ctx) => {
  const row = await loadOwnedRecipe(ctx, ctx.params.id, 'remove photos');
  const photo = await ctx.db
    .prepare('SELECT key FROM photos WHERE id=? AND recipe_id=?')
    .bind(ctx.params.photoId, row.id)
    .first();
  if (photo && !/^https?:\/\//.test(photo.key)) await ctx.env.PHOTOS.delete(photo.key);
  await ctx.db.prepare('DELETE FROM photos WHERE id=? AND recipe_id=?').bind(ctx.params.photoId, row.id).run();
  return json({ recipe: await recipeJson(ctx.db, row) });
});

// ---------- friends ----------

get('/api/friends', async (ctx) => {
  const me = requireUser(ctx);
  const ids = await friendIdsOf(ctx.db, me.id);
  const friends = await Promise.all(
    ids.map(async (id) => {
      const u = await ctx.db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
      const { n } = await ctx.db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE owner_id=?').bind(id).first();
      return { ...userPublic(u), recipeCount: n };
    })
  );
  friends.sort((a, b) => a.name.localeCompare(b.name));
  return json({ friends });
});

get('/api/friends/recipes', async (ctx) => {
  const me = requireUser(ctx);
  const ids = await friendIdsOf(ctx.db, me.id);
  const lists = await Promise.all(ids.map((id) => listRecipes(ctx.db, id)));
  return json({ recipes: lists.flat() });
});

get('/api/friends/:id/recipes', async (ctx) => {
  const me = requireUser(ctx);
  if (!(await areFriends(ctx.db, me.id, ctx.params.id))) throw new HttpError(403, 'Not in your friends');
  return json({ recipes: await listRecipes(ctx.db, ctx.params.id) });
});

del('/api/friends/:id', async (ctx) => {
  const me = requireUser(ctx);
  const [a, b] = pairKey(me.id, ctx.params.id);
  const { meta } = await ctx.db.prepare('DELETE FROM friendships WHERE user_a=? AND user_b=?').bind(a, b).run();
  if (!meta.changes) throw new HttpError(404, 'Not in your friends');
  return json({ ok: true });
});

// ---------- import ----------

post('/api/import', async (ctx) => {
  requireUser(ctx);
  const url = String((await ctx.json()).url || '').trim();
  if (!url) throw new HttpError(400, 'Paste a recipe link first');
  return json({ draft: await importFromUrl(url) });
});

// ---------- photo serving ----------

get('/uploads/:key', async (ctx) => {
  const key = ctx.params.key;
  if (!key || key.includes('..') || key.includes('/')) throw new HttpError(400, 'Invalid photo');
  const object = await ctx.env.PHOTOS.get(key);
  if (!object) throw new HttpError(404, 'Photo not found');
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

// ---------- entry point ----------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ctx = {
      request,
      env,
      db: env.DB,
      params: {},
      secure: url.protocol === 'https:',
      json: async () => {
        try {
          return await request.json();
        } catch {
          throw new HttpError(400, 'Expected a JSON body');
        }
      },
    };

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(url);
      if (!match) continue;
      ctx.params = match.pathname.groups;
      try {
        ctx.user = await currentUser(request, ctx.db);
        return await route.handler(ctx);
      } catch (err) {
        // Deliberate HttpErrors carry a message meant for the user; anything
        // else is a bug and gets logged, not leaked.
        if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
        console.error(err.stack || err);
        return json({ error: 'Something went wrong' }, { status: 500 });
      }
    }

    // Unmatched /api or /uploads path (assets are handled before the Worker)
    return json({ error: 'Not found' }, { status: 404 });
  },
};
