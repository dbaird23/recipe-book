// In-browser API for the static demo build (GitHub Pages). Same interface as
// the real api client, backed by localStorage — single-player, no server.
import { DEMO_MY_RECIPES, DEMO_FRIENDS } from './demoData.js';
import { autoNut } from './util.js';

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
    nut: src.nut || autoNut((src.ing || []).length),
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
  };
}

let state = null;
try {
  state = JSON.parse(localStorage.getItem(KEY));
} catch {
  /* corrupted storage — reseed on sign-in */
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* quota exceeded (usually big photos) — demo keeps working in memory */
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

function demoOnly() {
  throw new Error('This needs the real app — the demo is single-player');
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
      r.nut = { cal: +body.nut.cal || 0, pro: +body.nut.pro || 0, carb: +body.nut.carb || 0, fat: +body.nut.fat || 0 };
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
      if (!r.nutEdited) r.nut = autoNut(r.ing.length);
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

  importUrl: async () => {
    throw new Error('URL import needs the real server — try “paste the text” instead');
  },
};
