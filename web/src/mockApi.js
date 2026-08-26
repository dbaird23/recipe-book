// In-browser API for the static demo build (GitHub Pages). Same interface as
// the real api client, backed by localStorage. Single-player, no server.
import { DEMO_MY_RECIPES, DEMO_FRIENDS, DEMO_PANTRY } from './demoData.js';
import { autoNut, countIngredients, cleanNut, parsePantryEntry, grocerySection, GROCERY_SECTIONS, MEAL_SLOTS } from './util.js';

const KEY = 'recipe-book-demo-v1';
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function mkRecipe(src, ownerId, ownerName, authorsByName) {
  return {
    id: uid(),
    ownerId,
    ownerName,
    title: src.title,
    prep: src.prep || 0,
    cook: src.cook || 0,
    servings: src.servings || 1,
    tags: src.tags || [],
    ing: src.ing || [],
    dir: src.dir || [],
    notes: src.notes || '',
    source: src.source || null,
    from: src.from || null,
    nut: src.nut ? cleanNut(src.nut) : autoNut(countIngredients(src.ing || [])),
    // Nutrition supplied by an import or paste is real data, not an estimate
    nutEdited: !!src.nut,
    rating: src.rating || 0,
    createdAt: new Date().toISOString(),
    photos: [],
    comments: (src.comments || []).map((c) => ({
      id: uid(),
      text: c.text,
      photoUrl: null,
      createdAt: new Date().toISOString(),
      author: authorsByName[c.author] || { id: 'me', name: c.author, avatarUrl: null },
    })),
  };
}

function seed(meName, meEmail) {
  const me = { id: 'me', name: meName, email: meEmail, avatarUrl: null, isAdmin: true };
  const friends = DEMO_FRIENDS.map((f) => ({
    id: f.name.toLowerCase(),
    name: f.name,
    email: `${f.name.toLowerCase()}@example.com`,
    avatarUrl: null,
    isAdmin: false,
  }));
  const authorsByName = { You: me, [meName]: me };
  for (const f of friends) authorsByName[f.name] = { id: f.id, name: f.name, avatarUrl: null };
  return {
    me,
    myRecipes: DEMO_MY_RECIPES.map((r) => mkRecipe(r, 'me', meName, authorsByName)),
    friends: friends.map((f, i) => ({
      ...f,
      recipes: DEMO_FRIENDS[i].recipes.map((r) => mkRecipe(r, f.id, f.name, authorsByName)),
    })),
    pantry: DEMO_PANTRY.map((it) => ({ id: uid(), ...it })),
  };
}

let state = null;
try {
  state = JSON.parse(localStorage.getItem(KEY));
} catch {
  /* corrupted storage: reseed on sign-in */
}

// Demo state predates breakfast and lunch (one dinner per day), and then
// predates a meal being able to hold more than one thing. Both are brought
// forward to the shape the app reads now: every meal is a list.
if (Array.isArray(state?.plan)) {
  const asList = (m) => (m == null ? [] : Array.isArray(m) ? m : [m]);
  state.plan = state.plan.map((e) => ({
    date: e.date,
    note: e.note || '',
    meals: e.meals
      ? Object.fromEntries(MEAL_SLOTS.map(({ key }) => [key, asList(e.meals[key])]))
      : {
          breakfast: [],
          lunch: [],
          dinner: e.type ? [{ type: e.type, text: e.text || null, recipeId: e.recipeId || null }] : [],
        },
  }));
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded (usually big photos); demo keeps working in memory */
  }
}

function allRecipes() {
  return [...state.myRecipes, ...state.friends.flatMap((f) => f.recipes)];
}

function findRecipe(id) {
  const r = allRecipes().find((x) => x.id === id);
  if (!r) throw new Error('Recipe not found');
  return r;
}

function planRecipeOf(id) {
  const r = allRecipes().find((x) => x.id === id);
  if (!r) return null;
  return {
    id: r.id, title: r.title, ownerId: r.ownerId, ownerName: r.ownerName, mine: r.ownerId === state.me.id,
    prep: r.prep, cook: r.cook, servings: r.servings, ing: r.ing,
    photoUrl: r.photos?.[0]?.url || null,
  };
}

/** A stored day in the shape the app reads: every meal a list of entries. */
function readDay(e) {
  return {
    date: e.date,
    note: e.note || '',
    meals: Object.fromEntries(
      MEAL_SLOTS.map(({ key }) => [
        key,
        (e.meals[key] || []).map((m) => ({ ...m, recipe: m.type === 'recipe' ? planRecipeOf(m.recipeId) : null })),
      ])
    ),
  };
}

function demoOnly() {
  throw new Error('This needs the real app; the demo is single-player');
}

export const mockApi = {
  config: async () => ({ googleEnabled: false, devLoginEnabled: true, googleClientId: null, demo: true }),

  me: async () => {
    if (!state?.me) throw new Error('Not signed in');
    return { user: state.me };
  },
  authDev: async (name, email) => {
    if (!state) state = seed(name || 'Anna', email || 'demo@recipebook');
    else state.me = state.me || seed(name || 'Anna', email || 'demo@recipebook').me;
    save();
    return { user: state.me };
  },
  authGoogle: async () => demoOnly(),
  logout: async () => {
    state.me = null;
    save();
    return { ok: true };
  },
  updateMe: async (name) => {
    state.me.name = name;
    save();
    return { user: state.me };
  },
  uploadAvatar: async (file) => {
    state.me.avatarUrl = await fileToDataUrl(file);
    save();
    return { avatarUrl: state.me.avatarUrl };
  },
  removeAvatar: async () => {
    state.me.avatarUrl = null;
    save();
    return { ok: true };
  },

  inviteInfo: async () => demoOnly(),
  createInvite: async () => demoOnly(),

  oauthPending: async () => demoOnly(),
  oauthConsent: async () => demoOnly(),
  oauthGrants: async () => ({ grants: [] }),
  revokeGrant: async () => demoOnly(),

  apiKeys: async () => ({ keys: [] }),
  createApiKey: async () => demoOnly(),
  revokeApiKey: async () => demoOnly(),

  myRecipes: async () => ({ recipes: state.myRecipes }),
  createRecipe: async (body) => {
    const recipe = mkRecipe(
      {
        ...body,
        servings: +body.servings || 1,
        prep: +body.prep || 0,
        cook: +body.cook || 0,
        nut: body.nut || undefined,
      },
      'me',
      state.me.name,
      {}
    );
    recipe.photos = (body.photoUrls || []).map((url, i) => ({ id: uid(), url, position: i }));
    state.myRecipes.unshift(recipe);
    save();
    return { recipe };
  },
  getRecipe: async (id) => ({ recipe: findRecipe(id) }),
  updateRecipe: async (id, body) => {
    const r = findRecipe(id);
    if (body.nut && Object.keys(body).length <= 2) {
      r.nut = cleanNut(body.nut);
      r.nutEdited = body.nutEdited !== false;
    } else if ('rating' in body && Object.keys(body).length === 1) {
      r.rating = Math.max(0, Math.min(5, Math.round(+body.rating || 0)));
    } else if (typeof body.notes === 'string' && Object.keys(body).length === 1) {
      r.notes = body.notes;
    } else {
      Object.assign(r, {
        title: body.title,
        prep: +body.prep || 0,
        cook: +body.cook || 0,
        servings: +body.servings || 1,
        tags: body.tags || [],
        ing: body.ing || [],
        dir: body.dir || [],
        notes: body.notes || '',
        source: body.source ?? r.source,
        from: 'from' in body ? body.from || null : r.from,
      });
      if (!r.nutEdited) r.nut = autoNut(countIngredients(r.ing));
    }
    save();
    return { recipe: r };
  },
  deleteRecipe: async (id) => {
    state.myRecipes = state.myRecipes.filter((r) => r.id !== id);
    save();
    return { ok: true };
  },
  saveRecipe: async (id) => {
    const src = findRecipe(id);
    const copy = {
      ...src,
      id: uid(),
      ownerId: 'me',
      ownerName: state.me.name,
      from: src.ownerName,
      tags: [],
      comments: [],
      rating: 0,
      photos: src.photos.map((p) => ({ ...p, id: uid() })),
      createdAt: new Date().toISOString(),
    };
    state.myRecipes.unshift(copy);
    save();
    return { recipe: copy };
  },
  addComment: async (id, text, photoFile) => {
    const r = findRecipe(id);
    r.comments.push({
      id: uid(),
      text,
      photoUrl: photoFile ? await fileToDataUrl(photoFile) : null,
      createdAt: new Date().toISOString(),
      author: state.me,
    });
    save();
    return { recipe: r };
  },
  deleteComment: async (id, commentId) => {
    const r = findRecipe(id);
    const c = r.comments.find((x) => x.id === commentId);
    if (!c) throw new Error('Comment not found');
    if (c.author.id !== state.me.id) throw new Error('You can only delete your own comments');
    r.comments = r.comments.filter((x) => x.id !== commentId);
    save();
    return { recipe: r };
  },
  addPhoto: async (id, file) => {
    const r = findRecipe(id);
    r.photos.push({ id: uid(), url: await fileToDataUrl(file), position: r.photos.length });
    save();
    return { recipe: r };
  },
  removePhoto: async (id, photoId) => {
    const r = findRecipe(id);
    r.photos = r.photos.filter((p) => p.id !== photoId);
    save();
    return { recipe: r };
  },

  friends: async () => ({
    friends: state.friends
      .map(({ recipes, ...f }) => ({ ...f, recipeCount: recipes.length }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }),
  allFriendRecipes: async () => ({ recipes: state.friends.flatMap((f) => f.recipes) }),
  friendRecipes: async (id) => ({ recipes: state.friends.find((f) => f.id === id)?.recipes || [] }),
  removeFriend: async (id) => {
    state.friends = state.friends.filter((f) => f.id !== id);
    save();
    return { ok: true };
  },

  plan: async (start, end) => ({
    entries: (state.plan || []).filter((e) => e.date >= start && e.date <= end).map(readDay),
  }),
  setPlanDay: async (date, body) => {
    state.plan = state.plan || [];
    const prev = state.plan.find((e) => e.date === date) || {
      date, note: '', meals: { breakfast: [], lunch: [], dinner: [] },
    };
    // Whatever a meal is sent as replaces it: one entry, a list, or null
    for (const { key } of MEAL_SLOTS) {
      if (!(key in body)) continue;
      prev.meals[key] = (body[key] == null ? [] : [].concat(body[key])).map((d) => ({
        id: uid(),
        type: d.type,
        text: d.type === 'text' ? d.text : null,
        recipeId: d.type === 'recipe' ? d.recipeId : null,
      }));
    }
    if ('note' in body) prev.note = String(body.note || '').trim();
    state.plan = state.plan.filter((e) => e.date !== date);
    const anything = prev.note || MEAL_SLOTS.some(({ key }) => prev.meals[key].length);
    if (anything) state.plan.push(prev);
    save();
    return { entry: readDay(prev) };
  },

  pantry: async () => ({ items: state.pantry || [] }),
  addPantryItem: async (location, text) => {
    const p = parsePantryEntry(text);
    if (!p.name) throw new Error('Type something to add first');
    state.pantry = state.pantry || [];
    if (state.pantry.some((x) => x.location === location && x.name.toLowerCase() === p.name.toLowerCase())) {
      throw new Error(`Already in your ${location}`);
    }
    const item = { id: uid(), location, name: p.name, qty: p.qty, unit: p.unit };
    state.pantry.push(item);
    save();
    return { item };
  },
  renamePantryItem: async (id, text) => {
    const item = (state.pantry || []).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in your kitchen');
    const p = parsePantryEntry(text);
    if (!p.name) throw new Error('Type something first');
    if (state.pantry.some((x) => x !== item && x.location === item.location && x.name.toLowerCase() === p.name.toLowerCase())) {
      throw new Error(`Already in your ${item.location}`);
    }
    // A rename that doesn't lead with a number keeps the count it already had
    Object.assign(item, { name: p.name, qty: p.hadQty ? p.qty : item.qty, unit: p.hadQty ? p.unit : item.unit });
    save();
    return { item };
  },
  setPantryQty: async (id, qty) => {
    const item = (state.pantry || []).find((x) => x.id === id);
    if (!item) throw new Error('That item isn’t in your kitchen');
    item.qty = Math.max(0, +qty || 0);
    save();
    return { item };
  },
  removePantryItem: async (id) => {
    state.pantry = (state.pantry || []).filter((x) => x.id !== id);
    save();
    return { ok: true };
  },
  savePantryInventory: async (updates) => {
    let removed = 0;
    for (const u of updates) {
      const item = (state.pantry || []).find((x) => x.id === u.id);
      if (!item) continue;
      const qty = Math.max(0, +u.qty || 0);
      if (qty > 0) item.qty = qty;
      else removed++;
    }
    const gone = new Set(updates.filter((u) => !(+u.qty > 0)).map((u) => u.id));
    state.pantry = (state.pantry || []).filter((x) => !gone.has(x.id));
    save();
    return { items: state.pantry, removed };
  },

  groceries: async () => ({ items: state.groceries || [] }),
  addGroceryItem: async (text, section) => {
    const clean = String(text || '').trim().slice(0, 100);
    if (!clean) throw new Error('Type something to add first');
    const known = GROCERY_SECTIONS.some((s) => s.key === section);
    const item = { id: uid(), text: clean, section: known ? section : grocerySection(clean) };
    state.groceries = [...(state.groceries || []), item];
    save();
    return { item };
  },
  updateGroceryItem: async (id, text, section) => {
    const clean = String(text || '').trim().slice(0, 100);
    if (!clean) throw new Error('An item needs some words');
    const known = GROCERY_SECTIONS.some((s) => s.key === section);
    const item = { id, text: clean, section: known ? section : grocerySection(clean) };
    state.groceries = (state.groceries || []).map((x) => (x.id === id ? item : x));
    save();
    return { item };
  },
  removeGroceryItem: async (id) => {
    state.groceries = (state.groceries || []).filter((x) => x.id !== id);
    save();
    return { ok: true };
  },

  importUrl: async () => {
    throw new Error('URL import needs the real server. Try “paste the text” instead');
  },
};
