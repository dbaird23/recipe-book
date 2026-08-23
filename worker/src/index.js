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
import { bearerToken, userForToken, touchApiKey, listApiKeys, createApiKey, revokeApiKey } from './apikeys.js';
import { handleMcp } from './mcp.js';
import {
  HttpError, uid, nowIso, pairKey, json, autoNut, countIngredients, cleanNut, sanitizeRecipeInput, putImage, photoUrl,
  PANTRY_LOCATIONS, parsePantryEntry, GROCERY_SECTIONS, grocerySection, MEALS,
} from './util.js';

// ---------- tiny router ----------

const routes = [];
const on = (method, pattern, handler, opts = {}) =>
  routes.push({ method, pattern: new URLPattern({ pathname: pattern }), handler, key: !!opts.key });
const get = (p, h, o) => on('GET', p, h, o);
const post = (p, h, o) => on('POST', p, h, o);
const patch = (p, h, o) => on('PATCH', p, h, o);
const put = (p, h, o) => on('PUT', p, h, o);
const del = (p, h, o) => on('DELETE', p, h, o);

// Pass as the last argument to open a route to API keys. Keys are for reading
// and writing recipes and the meal plan. Account-level routes (invites,
// deleting, avatars, minting more keys) stay cookie-only on purpose.
const KEY = { key: true };

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

get('/api/me', (ctx) => json({ user: userPublic(requireUser(ctx)) }), KEY);

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

get('/api/recipes', async (ctx) => json({ recipes: await listRecipes(ctx.db, requireUser(ctx).id) }), KEY);

post('/api/recipes', async (ctx) => {
  const me = requireUser(ctx);
  const body = await ctx.json();
  const r = sanitizeRecipeInput(body);
  if (!r.title) throw new HttpError(400, 'Give it a title');
  const id = uid();
  const now = nowIso();
  const nut = r.nut || autoNut(countIngredients(r.ing));
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
}, KEY);

get('/api/recipes/:id', async (ctx) => json({ recipe: await recipeJson(ctx.db, await loadVisibleRecipe(ctx, ctx.params.id)) }), KEY);

patch('/api/recipes/:id', async (ctx) => {
  const row = await loadOwnedRecipe(ctx, ctx.params.id);
  const body = await ctx.json();
  const now = nowIso();

  if (body.nut && Object.keys(body).length <= 2) {
    // Nutrition-only adjustment (with optional nutEdited flag)
    const nut = cleanNut(body.nut);
    await ctx.db
      .prepare('UPDATE recipes SET nut=?, nut_edited=?, updated_at=? WHERE id=?')
      .bind(JSON.stringify(nut), body.nutEdited === false ? 0 : 1, now, row.id)
      .run();
  } else if ('rating' in body && Object.keys(body).length === 1) {
    // Only the owner rates their own recipe; loadOwnedRecipe already enforced that
    const rating = Math.round(+body.rating || 0);
    if (rating < 0 || rating > 5) throw new HttpError(400, 'Rating must be between 0 and 5 stars');
    await ctx.db.prepare('UPDATE recipes SET rating=?, updated_at=? WHERE id=?').bind(rating, now, row.id).run();
  } else if (typeof body.notes === 'string' && Object.keys(body).length === 1) {
    await ctx.db.prepare('UPDATE recipes SET notes=?, updated_at=? WHERE id=?').bind(body.notes.trim(), now, row.id).run();
  } else {
    const r = sanitizeRecipeInput(body);
    if (!r.title) throw new HttpError(400, 'Give it a title');
    const keepNut = row.nut_edited ? JSON.parse(row.nut) : autoNut(countIngredients(r.ing));
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
}, KEY);

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

// Save a friend's recipe into my book as a clean copy: no tags, no comments,
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
}, KEY);

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

// You can delete your own comment, wherever it lives, including on a
// friend's recipe. Nobody else's, not even the recipe owner's.
del('/api/recipes/:id/comments/:commentId', async (ctx) => {
  const me = requireUser(ctx);
  const row = await loadVisibleRecipe(ctx, ctx.params.id);
  const comment = await ctx.db
    .prepare('SELECT * FROM comments WHERE id=? AND recipe_id=?')
    .bind(ctx.params.commentId, row.id)
    .first();
  if (!comment) throw new HttpError(404, 'Comment not found');
  if (comment.author_id !== me.id) throw new HttpError(403, 'You can only delete your own comments');
  if (comment.photo_key && !/^https?:\/\//.test(comment.photo_key)) await ctx.env.PHOTOS.delete(comment.photo_key);
  await ctx.db.prepare('DELETE FROM comments WHERE id=?').bind(comment.id).run();
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
}, KEY);

get('/api/friends/recipes', async (ctx) => {
  const me = requireUser(ctx);
  const ids = await friendIdsOf(ctx.db, me.id);
  const lists = await Promise.all(ids.map((id) => listRecipes(ctx.db, id)));
  return json({ recipes: lists.flat() });
}, KEY);

get('/api/friends/:id/recipes', async (ctx) => {
  const me = requireUser(ctx);
  if (!(await areFriends(ctx.db, me.id, ctx.params.id))) throw new HttpError(403, 'Not in your friends');
  return json({ recipes: await listRecipes(ctx.db, ctx.params.id) });
}, KEY);

del('/api/friends/:id', async (ctx) => {
  const me = requireUser(ctx);
  const [a, b] = pairKey(me.id, ctx.params.id);
  const { meta } = await ctx.db.prepare('DELETE FROM friendships WHERE user_a=? AND user_b=?').bind(a, b).run();
  if (!meta.changes) throw new HttpError(404, 'Not in your friends');
  return json({ ok: true });
});

// ---------- meal plan ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireDate(d) {
  if (!DATE_RE.test(d || '')) throw new HttpError(400, 'Expected a date like 2026-08-17');
  return d;
}

/** Compact recipe shape for plan rows: enough to render a card and a grocery list. */
async function planRecipe(ctx, recipeId, myId, friendIds) {
  if (!recipeId) return null;
  const r = await ctx.db
    .prepare(
      `SELECT r.id, r.owner_id, r.title, r.prep, r.cook, r.servings, r.ing, u.name AS owner_name
       FROM recipes r JOIN users u ON u.id=r.owner_id WHERE r.id=?`
    )
    .bind(recipeId)
    .first();
  // A recipe you can no longer see (unfriended) is treated the same as a deleted one
  if (!r || (r.owner_id !== myId && !friendIds.includes(r.owner_id))) return null;
  const photo = await ctx.db
    .prepare('SELECT key FROM photos WHERE recipe_id=? ORDER BY position,id LIMIT 1')
    .bind(r.id)
    .first();
  return {
    id: r.id,
    title: r.title,
    ownerId: r.owner_id,
    ownerName: r.owner_name,
    mine: r.owner_id === myId,
    prep: r.prep,
    cook: r.cook,
    servings: r.servings,
    ing: JSON.parse(r.ing),
    photoUrl: photo ? photoUrl(photo.key) : null,
  };
}

/**
 * A day as the app and the MCP tools read it: three meals and a note. Each
 * meal is a list, because dinner is often two things: the meatball recipe and
 * the spaghetti you don't have a recipe for.
 */
const emptyDay = (date) => ({ date, note: '', meals: { breakfast: [], lunch: [], dinner: [] } });

/** Days in a range that have anything on them at all, oldest first. */
async function readPlan(ctx, me, start, end, friendIds) {
  const [rows, notes] = await Promise.all([
    ctx.db
      .prepare('SELECT * FROM plan_entries WHERE user_id=? AND date>=? AND date<=? ORDER BY date, position, rowid')
      .bind(me.id, start, end)
      .all(),
    ctx.db
      .prepare('SELECT date, note FROM plan_notes WHERE user_id=? AND date>=? AND date<=?')
      .bind(me.id, start, end)
      .all(),
  ]);

  const byDate = new Map();
  const dayOf = (date) => {
    if (!byDate.has(date)) byDate.set(date, emptyDay(date));
    return byDate.get(date);
  };
  const items = await Promise.all(
    rows.results.map(async (r) => ({
      row: r,
      item: {
        id: r.id,
        type: r.type,
        text: r.text,
        recipe: r.type === 'recipe' ? await planRecipe(ctx, r.recipe_id, me.id, friendIds) : null,
      },
    }))
  );
  for (const { row, item } of items) {
    const meal = dayOf(row.date).meals[row.meal];
    if (meal) meal.push(item);
  }
  for (const n of notes.results) dayOf(n.date).note = n.note || '';
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** Read one planned thing off a write body into the columns it's stored in. */
async function planItem(ctx, d, myId, friendIds) {
  if (d && d.type === 'recipe') {
    const r = await planRecipe(ctx, d.recipeId, myId, friendIds);
    if (!r) throw new HttpError(404, 'That recipe is not in your book');
    return { type: 'recipe', recipe_id: r.id, text: null };
  }
  if (d && d.type === 'leftovers') return { type: 'leftovers', recipe_id: null, text: null };
  if (d && d.type === 'text') {
    const t = String(d.text || '').trim();
    if (!t) throw new HttpError(400, 'Type something first');
    return { type: 'text', recipe_id: null, text: t.slice(0, 120) };
  }
  throw new HttpError(400, 'Unknown plan entry');
}

get('/api/plan', async (ctx) => {
  const me = requireUser(ctx);
  const url = new URL(ctx.request.url);
  const start = requireDate(url.searchParams.get('start'));
  const end = requireDate(url.searchParams.get('end'));
  const friendIds = await friendIdsOf(ctx.db, me.id);
  return json({ entries: await readPlan(ctx, me, start, end, friendIds) });
}, KEY);

// Upsert one day. Send `breakfast`, `lunch` or `dinner` to say what that meal
// is (one entry, a list of them, or null to clear it) and `note` to set or
// clear the note; omit any of them to leave as is. A meal that is sent is
// replaced wholesale, so removing one of its two dishes means sending the one
// that stays.
put('/api/plan/:date', async (ctx) => {
  const me = requireUser(ctx);
  const date = requireDate(ctx.params.date);
  const body = await ctx.json();
  const friendIds = await friendIdsOf(ctx.db, me.id);
  const now = nowIso();

  for (const meal of MEALS) {
    if (!(meal in body)) continue;
    const wanted = body[meal] === null ? [] : [].concat(body[meal]);
    // Everything is read and checked before anything is deleted, so a bad
    // entry leaves the meal as it was rather than half-cleared
    const items = [];
    for (const d of wanted.slice(0, 10)) items.push(await planItem(ctx, d, me.id, friendIds));
    // Clearing and refilling in one batch, so the meal is never briefly empty
    await ctx.db.batch([
      ctx.db.prepare('DELETE FROM plan_entries WHERE user_id=? AND date=? AND meal=?').bind(me.id, date, meal),
      ...items.map((m, i) =>
        ctx.db
          .prepare(
            'INSERT INTO plan_entries (id,user_id,date,meal,position,type,recipe_id,text,updated_at) VALUES (?,?,?,?,?,?,?,?,?)'
          )
          .bind(uid(), me.id, date, meal, i, m.type, m.recipe_id, m.text, now)
      ),
    ]);
  }

  if ('note' in body) {
    const note = String(body.note || '').trim().slice(0, 200);
    if (note) {
      await ctx.db
        .prepare(
          `INSERT INTO plan_notes (user_id,date,note,updated_at) VALUES (?,?,?,?)
           ON CONFLICT(user_id,date) DO UPDATE SET note=excluded.note, updated_at=excluded.updated_at`
        )
        .bind(me.id, date, note, now)
        .run();
    } else {
      await ctx.db.prepare('DELETE FROM plan_notes WHERE user_id=? AND date=?').bind(me.id, date).run();
    }
  }

  const [entry] = await readPlan(ctx, me, date, date, friendIds);
  return json({ entry: entry || emptyDay(date) });
}, KEY);

// ---------- pantry ----------

const pantryJson = (r) => ({ id: r.id, location: r.location, name: r.name, qty: r.qty, unit: r.unit || '' });

function requireLocation(v) {
  const loc = String(v || '').trim().toLowerCase();
  if (!PANTRY_LOCATIONS.includes(loc)) throw new HttpError(400, 'Location must be pantry, fridge or freezer');
  return loc;
}

/**
 * The item a write is asking for, from either a typed line (`text`) or
 * explicit fields. Renaming with a line that doesn't lead with a number keeps
 * the count it already had, so "Kidney beans" → "Black beans" stays at 3.
 */
function pantryFields(body, existing = null) {
  if (typeof body.text === 'string') {
    const p = parsePantryEntry(body.text);
    if (!p.name) throw new HttpError(400, 'Type something to add first');
    const recount = p.hadQty || !existing;
    return { name: p.name.slice(0, 80), qty: recount ? p.qty : existing.qty, unit: recount ? p.unit : existing.unit };
  }
  const name = String(body.name ?? existing?.name ?? '').trim();
  if (!name) throw new HttpError(400, 'Give the item a name');
  const qty = 'qty' in body ? Math.max(0, +body.qty || 0) : existing?.qty ?? 1;
  const unit = 'unit' in body ? String(body.unit || '').trim().toLowerCase().slice(0, 20) : existing?.unit ?? '';
  return { name: name.slice(0, 80), qty, unit };
}

const listPantry = async (db, userId) => {
  const { results } = await db
    .prepare('SELECT * FROM pantry_items WHERE user_id=? ORDER BY created_at, rowid')
    .bind(userId)
    .all();
  return results.map(pantryJson);
};

async function loadPantryItem(ctx, id) {
  const me = requireUser(ctx);
  const row = await ctx.db.prepare('SELECT * FROM pantry_items WHERE id=? AND user_id=?').bind(id, me.id).first();
  if (!row) throw new HttpError(404, 'That item isn’t in your kitchen');
  return row;
}

async function assertNoClash(ctx, userId, location, name, exceptId = null) {
  const clash = await ctx.db
    .prepare('SELECT id FROM pantry_items WHERE user_id=? AND location=? AND name=? COLLATE NOCASE AND id<>?')
    .bind(userId, location, name, exceptId || '')
    .first();
  if (clash) throw new HttpError(409, `Already in your ${location}`);
}

get('/api/pantry', async (ctx) => json({ items: await listPantry(ctx.db, requireUser(ctx).id) }), KEY);

post('/api/pantry', async (ctx) => {
  const me = requireUser(ctx);
  const body = await ctx.json();
  const location = requireLocation(body.location);
  const fields = pantryFields(body);
  await assertNoClash(ctx, me.id, location, fields.name);
  const id = uid();
  const now = nowIso();
  await ctx.db
    .prepare('INSERT INTO pantry_items (id,user_id,location,name,qty,unit,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(id, me.id, location, fields.name, fields.qty, fields.unit, now, now)
    .run();
  return json({ item: { id, location, ...fields } });
}, KEY);

patch('/api/pantry/:id', async (ctx) => {
  const me = requireUser(ctx);
  const row = await loadPantryItem(ctx, ctx.params.id);
  const body = await ctx.json();
  const location = 'location' in body ? requireLocation(body.location) : row.location;
  const fields = pantryFields(body, pantryJson(row));
  await assertNoClash(ctx, me.id, location, fields.name, row.id);
  await ctx.db
    .prepare('UPDATE pantry_items SET location=?,name=?,qty=?,unit=?,updated_at=? WHERE id=?')
    .bind(location, fields.name, fields.qty, fields.unit, nowIso(), row.id)
    .run();
  return json({ item: { id: row.id, location, ...fields } });
}, KEY);

del('/api/pantry/:id', async (ctx) => {
  const row = await loadPantryItem(ctx, ctx.params.id);
  await ctx.db.prepare('DELETE FROM pantry_items WHERE id=?').bind(row.id).run();
  return json({ ok: true });
}, KEY);

// The end of a "take inventory" pass down the shelves: every item you send
// gets that count, and a count of zero means you're out, so the row goes.
// Items you leave out are untouched.
put('/api/pantry', async (ctx) => {
  const me = requireUser(ctx);
  const updates = (await ctx.json()).items;
  if (!Array.isArray(updates) || !updates.length) throw new HttpError(400, 'Nothing to save');
  const now = nowIso();
  let removed = 0;
  const stmts = updates.slice(0, 200).map((u) => {
    const qty = Math.max(0, +u.qty || 0);
    if (qty > 0) {
      return ctx.db
        .prepare('UPDATE pantry_items SET qty=?, updated_at=? WHERE id=? AND user_id=?')
        .bind(qty, now, String(u.id), me.id);
    }
    removed++;
    return ctx.db.prepare('DELETE FROM pantry_items WHERE id=? AND user_id=?').bind(String(u.id), me.id);
  });
  await ctx.db.batch(stmts);
  return json({ items: await listPantry(ctx.db, me.id), removed });
}, KEY);

// ---------- grocery list ----------
//
// Only the hand-added part lives here. Everything from the meal plan is worked
// out on the fly from the plan and the pantry, so there's nothing to store and
// nothing to go stale when a recipe changes.

const groceryJson = (r) => ({ id: r.id, text: r.text, section: r.section });

get('/api/groceries', async (ctx) => {
  const me = requireUser(ctx);
  const { results } = await ctx.db
    .prepare('SELECT * FROM grocery_items WHERE user_id=? ORDER BY created_at, rowid')
    .bind(me.id)
    .all();
  return json({ items: results.map(groceryJson) });
}, KEY);

post('/api/groceries', async (ctx) => {
  const me = requireUser(ctx);
  const body = await ctx.json();
  const text = String(body.text ?? '').trim().slice(0, 100);
  if (!text) throw new HttpError(400, 'Type something to add first');
  const asked = String(body.section || '').trim().toLowerCase();
  const section = GROCERY_SECTIONS.some((s) => s.key === asked) ? asked : grocerySection(text);
  const id = uid();
  const now = nowIso();
  await ctx.db
    .prepare('INSERT INTO grocery_items (id,user_id,text,section,created_at,updated_at) VALUES (?,?,?,?,?,?)')
    .bind(id, me.id, text, section, now, now)
    .run();
  return json({ item: { id, text, section } });
}, KEY);

del('/api/groceries/:id', async (ctx) => {
  const me = requireUser(ctx);
  const row = await ctx.db
    .prepare('SELECT id FROM grocery_items WHERE id=? AND user_id=?')
    .bind(ctx.params.id, me.id)
    .first();
  if (!row) throw new HttpError(404, 'That isn’t on your grocery list');
  await ctx.db.prepare('DELETE FROM grocery_items WHERE id=?').bind(row.id).run();
  return json({ ok: true });
}, KEY);

// ---------- import ----------

post('/api/import', async (ctx) => {
  requireUser(ctx);
  const url = String((await ctx.json()).url || '').trim();
  if (!url) throw new HttpError(400, 'Paste a recipe link first');
  return json({ draft: await importFromUrl(url) });
}, KEY);

// ---------- API keys ----------
//
// Cookie-only, all three: a key must never be able to mint or list keys, or
// leaking one would be permanent.

get('/api/keys', async (ctx) => json({ keys: await listApiKeys(ctx.db, requireUser(ctx).id) }));

post('/api/keys', async (ctx) => {
  const me = requireUser(ctx);
  const { token, key } = await createApiKey(ctx.db, me.id, (await ctx.json()).name);
  // In dev the Worker sits behind the Vite proxy, so the browser's origin is
  // the one that will actually work in a config file
  const origin = ctx.request.headers.get('origin') || new URL(ctx.request.url).origin;
  return json({ token, key, mcpUrl: `${origin}/mcp` });
});

del('/api/keys/:id', async (ctx) => {
  await revokeApiKey(ctx.db, requireUser(ctx).id, ctx.params.id);
  return json({ ok: true });
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

// ---------- calling our own routes ----------

/**
 * Run one of our own API routes in-process, as whoever `base` is signed in as.
 * The MCP tools go through here so they share the web app's exact permission
 * checks and response shapes instead of reaching into the database themselves.
 */
async function callApi(base, method, path, body) {
  const url = new URL(path, new URL(base.request.url).origin);
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(url);
    if (!match) continue;
    if (!route.key) throw new HttpError(403, `${method} ${path} is not available to API keys`);
    const res = await route.handler({
      ...base,
      params: match.pathname.groups,
      request: new Request(url, { method }),
      json: async () => body || {},
    });
    return res.json();
  }
  throw new HttpError(404, `No route for ${method} ${path}`);
}

// ---------- entry point ----------

export default {
  async fetch(request, env, execCtx) {
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

    /** Cookie or API key, whichever the caller brought. Sets ctx.user/ctx.key. */
    const authenticate = async () => {
      const token = bearerToken(request);
      if (!token) {
        ctx.user = await currentUser(request, ctx.db);
        return;
      }
      const found = await userForToken(ctx.db, token);
      if (!found) throw new HttpError(401, 'That API key isn’t valid. It may have been revoked');
      ctx.user = found.user;
      ctx.key = found.key;
      execCtx?.waitUntil(touchApiKey(ctx.db, found.key.id));
    };

    // MCP lives outside the REST router: it is one endpoint that multiplexes
    // every tool over JSON-RPC, and it takes API keys only, never a cookie.
    if (url.pathname === '/mcp') {
      try {
        if (request.method === 'POST') await authenticate();
        return await handleMcp(request, {
          authed: !!ctx.key,
          call: (method, path, body) => callApi(ctx, method, path, body),
        });
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        if (!(err instanceof HttpError)) console.error(err.stack || err);
        return json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: err.message } }, { status });
      }
    }

    for (const route of routes) {
      if (route.method !== request.method) continue;
      const match = route.pattern.exec(url);
      if (!match) continue;
      ctx.params = match.pathname.groups;
      try {
        await authenticate();
        if (ctx.key && !route.key) {
          throw new HttpError(403, 'API keys can only reach recipes and the meal plan. Sign in for this one');
        }
        return await route.handler(ctx);
      } catch (err) {
        // Deliberate HttpErrors carry a message meant for the user; anything
        // else is a bug and gets logged, not leaked.
        if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
        console.error(err.stack || err);
        return json({ error: 'Something went wrong' }, { status: 500 });
      }
    }

    // Unmatched /api, /uploads or /mcp path (assets are handled before the Worker)
    return json({ error: 'Not found' }, { status: 404 });
  },
};
