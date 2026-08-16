// Model Context Protocol server — the front door for AI assistants (Cursor,
// Claude, anything that speaks MCP).
//
// Transport is Streamable HTTP at POST /mcp, run statelessly: no session id,
// every request carries its own API key, replies are plain JSON rather than
// SSE. Auth is bearer-only; a browser cookie is deliberately not enough.
//
// The tools don't touch the database. Each one calls the same route handlers
// the web app uses, so permissions, validation and shapes can never drift
// between the two.
import { HttpError, json } from './util.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'recipe-book', title: 'Recipe Book', version: '1.0.0' };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version',
  'access-control-max-age': '86400',
};

// ---------- shaping ----------

const minutes = { type: 'integer', minimum: 0 };

const RECIPE_PROPS = {
  title: { type: 'string', description: 'What the recipe is called' },
  ing: { type: 'array', items: { type: 'string' }, description: 'Ingredients, one line each, e.g. "2 cups flour"' },
  dir: { type: 'array', items: { type: 'string' }, description: 'Directions, one step per entry' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Free-form labels, e.g. "Dinner", "Vegetarian"' },
  prep: { ...minutes, description: 'Prep time in minutes' },
  cook: { ...minutes, description: 'Cook time in minutes' },
  servings: { type: 'integer', minimum: 1 },
  notes: { type: 'string' },
  source: { type: 'string', description: 'Where it came from — a URL, a site name, or a cookbook' },
  rating: { type: 'integer', minimum: 0, maximum: 5, description: 'Your own 1–5 star rating; 0 clears it' },
};

const EDITABLE = ['title', 'ing', 'dir', 'tags', 'prep', 'cook', 'servings', 'notes', 'source'];

const summary = (r) => ({
  recipeId: r.id,
  title: r.title,
  owner: r.ownerName,
  tags: r.tags,
  prepMinutes: r.prep,
  cookMinutes: r.cook,
  servings: r.servings,
  rating: r.rating || undefined,
  ingredientCount: r.ing.length,
});

const detail = (r) => ({
  recipeId: r.id,
  title: r.title,
  owner: r.ownerName,
  tags: r.tags,
  prepMinutes: r.prep,
  cookMinutes: r.cook,
  servings: r.servings,
  rating: r.rating || undefined,
  ingredients: r.ing,
  directions: r.dir,
  notes: r.notes || undefined,
  source: r.source || undefined,
  savedFrom: r.from || undefined,
  nutritionPerServing: r.nut,
  comments: r.comments.map((c) => ({ from: c.author.name, text: c.text })),
});

const dinnerOf = (e) => {
  if (e.type === 'recipe') {
    // The plan keeps the day but drops the link when a recipe is deleted or
    // its owner is unfriended — say so rather than reporting an empty night.
    if (!e.recipe) return { type: 'recipe', unavailable: 'That recipe is no longer in your book' };
    return { type: 'recipe', recipeId: e.recipe.id, title: e.recipe.title, owner: e.recipe.ownerName, servings: e.recipe.servings };
  }
  if (e.type === 'leftovers') return { type: 'leftovers' };
  if (e.type === 'text') return { type: 'text', text: e.text };
  return null;
};

const planDay = (e) => ({ date: e.date, dinner: dinnerOf(e), note: e.note || undefined });

function matches(recipe, q) {
  const haystack = [recipe.title, ...recipe.tags, ...recipe.ing].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/** The importer speaks its own draft dialect (strings, newline-joined). */
const draftToRecipe = (d) => ({
  title: d.title,
  prep: +d.prep || 0,
  cook: +d.cook || 0,
  servings: +d.serv || 1,
  ing: String(d.ing || '').split('\n').map((s) => s.trim()).filter(Boolean),
  dir: String(d.dirs || '').split('\n').map((s) => s.trim()).filter(Boolean),
  notes: d.notes || '',
  source: d.source || null,
  nut: d.nutImport || null,
  photoUrls: d.images || [],
});

// ---------- tools ----------

const TOOLS = [
  {
    name: 'whoami',
    title: 'Who am I',
    description: 'Check which Recipe Book account this API key belongs to. Useful for confirming the connection works.',
    inputSchema: { type: 'object', properties: {} },
    run: async (call) => (await call('GET', '/api/me')).user,
  },

  {
    name: 'list_recipes',
    title: 'List recipes',
    description:
      'List recipes in the book — your own, the ones your friends have shared, or both. Returns summaries; call get_recipe for ingredients and directions.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['mine', 'friends', 'all'], description: 'Whose recipes to list. Defaults to "all".' },
        query: { type: 'string', description: 'Optional filter — matches title, tags and ingredients' },
      },
    },
    run: async (call, args) => {
      const scope = args.scope || 'all';
      const lists = [];
      if (scope !== 'friends') lists.push((await call('GET', '/api/recipes')).recipes);
      if (scope !== 'mine') lists.push((await call('GET', '/api/friends/recipes')).recipes);
      let recipes = lists.flat();
      const q = String(args.query || '').trim().toLowerCase();
      if (q) recipes = recipes.filter((r) => matches(r, q));
      return { count: recipes.length, recipes: recipes.map(summary) };
    },
  },

  {
    name: 'get_recipe',
    title: 'Get a recipe',
    description: 'Read one recipe in full: ingredients, directions, notes, nutrition and comments.',
    inputSchema: {
      type: 'object',
      properties: { recipeId: { type: 'string' } },
      required: ['recipeId'],
    },
    run: async (call, args) => detail((await call('GET', `/api/recipes/${encodeURIComponent(args.recipeId)}`)).recipe),
  },

  {
    name: 'create_recipe',
    title: 'Add a recipe',
    description: 'Add a new recipe to your book. Only the title is required, but a recipe is far more useful with ingredients and directions.',
    inputSchema: {
      type: 'object',
      properties: { ...RECIPE_PROPS },
      required: ['title'],
    },
    run: async (call, args) => {
      const body = {};
      for (const field of EDITABLE) if (field in args) body[field] = args[field];
      const { recipe } = await call('POST', '/api/recipes', body);
      if (args.rating) await call('PATCH', `/api/recipes/${recipe.id}`, { rating: args.rating });
      return { created: true, ...detail(recipe) };
    },
  },

  {
    name: 'update_recipe',
    title: 'Edit a recipe',
    description:
      'Change a recipe you own. Send only the fields you want to change — everything else is left as it is. Cannot edit a friend’s recipe.',
    inputSchema: {
      type: 'object',
      properties: { recipeId: { type: 'string' }, ...RECIPE_PROPS },
      required: ['recipeId'],
    },
    run: async (call, args) => {
      const path = `/api/recipes/${encodeURIComponent(args.recipeId)}`;
      // The edit route replaces the whole recipe, so start from the current
      // one and lay the caller's fields on top
      const { recipe: current } = await call('GET', path);
      const body = {};
      for (const field of EDITABLE) body[field] = field in args ? args[field] : current[field];
      let { recipe } = await call('PATCH', path, body);
      if ('rating' in args) ({ recipe } = await call('PATCH', path, { rating: args.rating }));
      return { updated: true, ...detail(recipe) };
    },
  },

  {
    name: 'import_recipe_from_url',
    title: 'Import a recipe from a link',
    description:
      'Read a recipe off a web page. Returns the parsed recipe; pass save: true to add it to your book straight away, or review it first and then call create_recipe.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Link to a recipe page' },
        save: { type: 'boolean', description: 'Add it to your book immediately. Defaults to false.' },
      },
      required: ['url'],
    },
    run: async (call, args) => {
      const { draft } = await call('POST', '/api/import', { url: args.url });
      const body = draftToRecipe(draft);
      if (!args.save) return { saved: false, author: draft.author || undefined, recipe: body };
      const { recipe } = await call('POST', '/api/recipes', body);
      return { saved: true, ...detail(recipe) };
    },
  },

  {
    name: 'get_meal_plan',
    title: 'Read the meal plan',
    description: 'What is planned for dinner across a date range, one entry per planned day. Days with nothing planned are simply absent.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'First day, YYYY-MM-DD' },
        end: { type: 'string', description: 'Last day, YYYY-MM-DD (inclusive)' },
      },
      required: ['start', 'end'],
    },
    run: async (call, args) => {
      const { entries } = await call('GET', `/api/plan?start=${encodeURIComponent(args.start)}&end=${encodeURIComponent(args.end)}`);
      return { start: args.start, end: args.end, days: entries.map(planDay) };
    },
  },

  {
    name: 'set_meal_plan_day',
    title: 'Plan a day',
    description:
      'Set or clear what is for dinner on one day, and/or its note. Omit a field to leave it alone; pass dinner: null to clear the meal. Recipes must already be in your book or a friend’s.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD' },
        dinner: {
          type: ['object', 'null'],
          description: 'What is for dinner, or null to clear it',
          properties: {
            type: { type: 'string', enum: ['recipe', 'leftovers', 'text'] },
            recipeId: { type: 'string', description: 'Required when type is "recipe"' },
            text: { type: 'string', description: 'Required when type is "text" — e.g. "Takeout"' },
          },
          required: ['type'],
        },
        note: { type: 'string', description: 'A note for the day; pass an empty string to clear it' },
      },
      required: ['date'],
    },
    run: async (call, args) => {
      const body = {};
      if ('dinner' in args) body.dinner = args.dinner;
      if ('note' in args) body.note = args.note;
      const { entry } = await call('PUT', `/api/plan/${encodeURIComponent(args.date)}`, body);
      return planDay(entry);
    },
  },

  {
    name: 'grocery_list',
    title: 'Build a grocery list',
    description:
      'Every ingredient from the recipes planned in a date range, grouped by recipe. Quantities are left exactly as the recipes write them — nothing is combined or converted.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'First day, YYYY-MM-DD' },
        end: { type: 'string', description: 'Last day, YYYY-MM-DD (inclusive)' },
      },
      required: ['start', 'end'],
    },
    run: async (call, args) => {
      const { entries } = await call('GET', `/api/plan?start=${encodeURIComponent(args.start)}&end=${encodeURIComponent(args.end)}`);
      const fromRecipes = entries
        .filter((e) => e.recipe)
        .map((e) => ({ date: e.date, recipeId: e.recipe.id, title: e.recipe.title, servings: e.recipe.servings, ingredients: e.recipe.ing }));
      // Nights that are takeout, leftovers or a plain note have no ingredients
      // but still belong in the answer — they're meals you don't shop for.
      const noIngredients = entries
        .filter((e) => e.type && !e.recipe)
        .map((e) => ({ date: e.date, dinner: dinnerOf(e) }));
      return {
        start: args.start,
        end: args.end,
        itemCount: fromRecipes.reduce((n, r) => n + r.ingredients.length, 0),
        recipes: fromRecipes,
        nothingToBuy: noIngredients.length ? noIngredients : undefined,
      };
    },
  },
];

const TOOL_LIST = TOOLS.map(({ run, ...spec }) => spec);
const BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

// ---------- JSON-RPC ----------

const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function handleMessage(message, call) {
  const { id, method, params = {} } = message || {};
  // A notification (no id) needs no reply — `initialized` is the common one
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        // Meet the client on its version when we understand it, so an older
        // client isn't turned away over a number
        protocolVersion: params.protocolVersion === '2025-03-26' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Recipe Book is a small, invite-only recipe collection shared between family and friends. ' +
          'Recipes belong to people: you can read and plan with anyone’s, but only edit your own. ' +
          'Dates are always YYYY-MM-DD in the planner.',
      });

    case 'ping':
      return reply(id, {});

    case 'tools/list':
      return reply(id, { tools: TOOL_LIST });

    case 'tools/call': {
      const tool = BY_NAME.get(params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const data = await tool.run(call, params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
      } catch (err) {
        // Tool failures are results, not protocol errors — the model should
        // see what went wrong and get a chance to fix its arguments
        if (!(err instanceof HttpError)) console.error(err.stack || err);
        const text = err instanceof HttpError ? err.message : 'Something went wrong running that tool';
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/**
 * Serve POST /mcp. `call(method, path, body)` runs one of our own API routes
 * as the key's owner; `authed` says whether a valid API key was presented.
 */
export async function handleMcp(request, { authed, call }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return json(fail(null, -32600, 'Send MCP requests as POST'), { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
  }
  if (!authed) {
    return json(fail(null, -32001, 'Add an API key: Authorization: Bearer rb_…'), {
      status: 401,
      headers: { ...CORS, 'www-authenticate': 'Bearer' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json(fail(null, -32700, 'Parse error'), { status: 400, headers: CORS });
  }

  const batch = Array.isArray(body);
  const replies = [];
  for (const message of batch ? body : [body]) {
    const out = await handleMessage(message, call);
    if (out) replies.push(out);
  }
  // Notifications only — nothing to say back
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0], { headers: CORS });
}
