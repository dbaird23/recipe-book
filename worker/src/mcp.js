// Model Context Protocol server: the front door for AI assistants (Cursor,
// Claude, anything that speaks MCP).
//
// Transport is Streamable HTTP at POST /mcp, run statelessly: no session id,
// every request carries its own credentials, replies are plain JSON rather than
// SSE. Auth is bearer-only; a browser cookie is deliberately not enough.
//
// Two ways to hold that bearer. A client that can keep a static header (Cursor,
// a script) uses an API key. A client that can't (ChatGPT, whose connectors
// have nowhere to put one) runs OAuth instead: it calls this endpoint cold, the
// 401 below points it at the protected-resource metadata, and it takes itself
// through the flow in oauth.js. Both arrive here as a bearer token.
//
// The tools don't touch the database. Each one calls the same route handlers
// the web app uses, so permissions, validation and shapes can never drift
// between the two.
import {
  HttpError, json, PANTRY_LOCATIONS, pantrySkip, GROCERY_SECTIONS, grocerySection, MEALS,
  isIngredientHeading, countIngredients, sniffImageType,
} from './util.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'recipe-book', title: 'Pinch', version: '1.0.0' };

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, mcp-protocol-version, mcp-session-id',
  'access-control-expose-headers': 'www-authenticate, mcp-protocol-version',
  'access-control-max-age': '86400',
};

// ---------- shaping ----------

const minutes = { type: 'integer', minimum: 0 };

const RECIPE_PROPS = {
  title: { type: 'string', description: 'What the recipe is called' },
  ing: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Ingredients, one line each, e.g. "2 cups flour". A recipe made of parts can be split into sections with a line that ends in a colon, e.g. "For the meatballs:", which names every line under it until the next such heading.',
  },
  dir: { type: 'array', items: { type: 'string' }, description: 'Directions, one step per entry' },
  tags: { type: 'array', items: { type: 'string' }, description: 'Free-form labels, e.g. "Dinner", "Vegetarian"' },
  prep: { ...minutes, description: 'Prep time in minutes' },
  cook: { ...minutes, description: 'Cook time in minutes' },
  servings: { type: 'integer', minimum: 1 },
  notes: { type: 'string' },
  source: { type: 'string', description: 'Where it came from: a URL, a site name, or a cookbook' },
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
  ingredientCount: countIngredients(r.ing),
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

const itemOf = (m) => {
  if (!m) return undefined;
  if (m.type === 'recipe') {
    // The plan keeps the entry but drops the link when a recipe is deleted or
    // its owner is unfriended, so say so rather than reporting an empty meal.
    if (!m.recipe) return { type: 'recipe', unavailable: 'That recipe is no longer in your book' };
    return { type: 'recipe', recipeId: m.recipe.id, title: m.recipe.title, owner: m.recipe.ownerName, servings: m.recipe.servings };
  }
  if (m.type === 'leftovers') return { type: 'leftovers' };
  if (m.type === 'text') return { type: 'text', text: m.text };
  return undefined;
};

// A meal is a list: often one thing, sometimes a recipe plus the side that
// doesn't have one ("spaghetti"). Meals with nothing planned are left out
// rather than reported as empty.
const mealOf = (list) => {
  const items = (list || []).map(itemOf).filter(Boolean);
  return items.length ? items : undefined;
};

const planDay = (e) => ({
  date: e.date,
  ...Object.fromEntries(MEALS.map((meal) => [meal, mealOf(e.meals[meal])]).filter(([, v]) => v)),
  note: e.note || undefined,
});

const pantryItem = (i) => ({
  itemId: i.id,
  location: i.location,
  name: i.name,
  quantity: i.qty,
  unit: i.unit || undefined,
});

/** One thing on a meal: a recipe, leftovers, or a line you just typed. */
const PLAN_ENTRY = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['recipe', 'leftovers', 'text'] },
    recipeId: { type: 'string', description: 'Required when type is "recipe"' },
    text: { type: 'string', description: 'Required when type is "text", e.g. "Takeout", "garlic bread"' },
  },
  required: ['type'],
};

const LOCATION = { type: 'string', enum: PANTRY_LOCATIONS, description: 'Where it lives in the kitchen' };

const SECTION_KEYS = GROCERY_SECTIONS.map((s) => s.key);
const SECTION = {
  type: 'string',
  enum: SECTION_KEYS,
  description: 'Which aisle it is filed under. Leave it out and it will be guessed from the text.',
};

function matches(recipe, q) {
  const haystack = [recipe.title, ...recipe.tags, ...recipe.ing].join(' ').toLowerCase();
  return q.split(/\s+/).every((word) => haystack.includes(word));
}

/**
 * One photo, as an assistant is able to send it: base64, or the data: URL it
 * probably already has it in. The declared media type is ignored in favour of
 * the bytes, which can't be mislabelled, and the result is the same File the
 * browser would have uploaded so the scan route can't tell the two apart.
 */
function photoFile(value, index) {
  const which = `Photo ${index + 1}`;
  if (typeof value !== 'string') throw new HttpError(400, `${which} isn’t base64 image data`);
  // Both "data:image/jpeg;base64,…" and the bare payload, minus the line
  // breaks that wrapping a long string tends to leave in it.
  const payload = value.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  let bytes;
  try {
    const binary = atob(payload);
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
  } catch {
    throw new HttpError(400, `${which} isn’t valid base64`);
  }
  const type = sniffImageType(bytes);
  if (!type) throw new HttpError(400, `${which} isn’t a jpeg, png, webp or gif`);
  return new File([bytes], `photo-${index + 1}`, { type });
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
    description: 'Check which Pinch account this API key belongs to. Useful for confirming the connection works.',
    inputSchema: { type: 'object', properties: {} },
    run: async (call) => (await call('GET', '/api/me')).user,
  },

  {
    name: 'list_recipes',
    title: 'List recipes',
    description:
      'List recipes in the book: your own, the ones your friends have shared, or both. Returns summaries; call get_recipe for ingredients and directions.',
    inputSchema: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['mine', 'friends', 'all'], description: 'Whose recipes to list. Defaults to "all".' },
        query: { type: 'string', description: 'Optional filter that matches title, tags and ingredients' },
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
      'Change a recipe you own. Send only the fields you want to change; everything else is left as it is. Cannot edit a friend’s recipe.',
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
    name: 'read_recipe_from_photo',
    title: 'Read a recipe from a photo',
    description:
      'Transcribe a recipe from a photograph of it: a cookbook page, a handwritten card, a clipping, a screenshot. ' +
      'Returns the recipe as read; pass save: true to add it to the book straight away, or show it to the member first and then call create_recipe. ' +
      'Anything the photo doesn’t say is left blank rather than guessed at, and a quantity that couldn’t be read is left out entirely, so it is worth reading back the times, the servings and anything that looks short before saving. ' +
      'The photo itself is not kept with the recipe; it is only read.',
    inputSchema: {
      type: 'object',
      properties: {
        photos: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The photo as base64, or as a data: URL. Up to 4 photos of ONE recipe, in reading order, for a recipe that runs over the page — not 4 different recipes. JPEG, PNG, WebP or GIF.',
          minItems: 1,
          maxItems: 4,
        },
        save: { type: 'boolean', description: 'Add it to the book immediately. Defaults to false.' },
      },
      required: ['photos'],
    },
    run: async (call, args) => {
      const photos = [].concat(args.photos ?? []);
      if (!photos.length) throw new HttpError(400, 'Send at least one photo');
      const form = new FormData();
      photos.forEach((photo, i) => form.append('photo', photoFile(photo, i)));
      const { draft } = await call('POST', '/api/scan', form);
      const body = draftToRecipe(draft);
      if (!args.save) return { saved: false, recipe: body };
      const { recipe } = await call('POST', '/api/recipes', body);
      return { saved: true, ...detail(recipe) };
    },
  },

  {
    name: 'get_meal_plan',
    title: 'Read the meal plan',
    description:
      'What is planned to eat across a date range: breakfast, lunch and dinner, one entry per planned day. Each meal is a list, since a meal can be several things (a recipe plus a side). Meals with nothing planned are left out, and days with nothing at all are simply absent.',
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
      'Set or clear any of breakfast, lunch and dinner on one day, and/or its note. A meal can be several things at once, so pass a list, e.g. a meatball recipe plus "spaghetti" as text. Whatever you send replaces that meal entirely; omit a meal to leave it alone, or pass null to clear it. Recipes must already be in your book or a friend’s.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD' },
        ...Object.fromEntries(
          MEALS.map((meal) => [
            meal,
            {
              type: ['array', 'object', 'null'],
              description: `What is for ${meal}: one entry or a list of them, or null to clear it`,
              items: { $ref: '#/$defs/planEntry' },
              properties: PLAN_ENTRY.properties,
              required: PLAN_ENTRY.required,
            },
          ])
        ),
        note: { type: 'string', description: 'A note for the day; pass an empty string to clear it' },
      },
      required: ['date'],
      $defs: { planEntry: PLAN_ENTRY },
    },
    run: async (call, args) => {
      const body = {};
      for (const meal of MEALS) if (meal in args) body[meal] = args[meal];
      if ('note' in args) body.note = args.note;
      const { entry } = await call('PUT', `/api/plan/${encodeURIComponent(args.date)}`, body);
      return planDay(entry);
    },
  },

  {
    name: 'get_pantry',
    title: 'Read the pantry',
    description:
      'What is already in the kitchen: the pantry, the fridge and the freezer. The grocery list skips these, so read it before suggesting a shop.',
    inputSchema: {
      type: 'object',
      properties: { location: { ...LOCATION, description: 'Only this shelf. Omit for everything.' } },
    },
    run: async (call, args) => {
      const { items } = await call('GET', '/api/pantry');
      const kept = args.location ? items.filter((i) => i.location === args.location) : items;
      return { count: kept.length, items: kept.map(pantryItem) };
    },
  },

  {
    name: 'add_pantry_item',
    title: 'Add to the pantry',
    description:
      'Put something in the kitchen. Either pass a typed line as `item` ("2 cans black beans") and it will be read apart, or give name, quantity and unit yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        location: LOCATION,
        item: { type: 'string', description: 'A whole line, e.g. "2 cans black beans" or "Olive oil"' },
        name: { type: 'string', description: 'Just the name, when you would rather not have `item` parsed' },
        quantity: { type: 'number', minimum: 0, description: 'How many. Defaults to 1.' },
        unit: { type: 'string', description: 'e.g. "cans", "lbs", "bottle". Leave out for a plain count.' },
      },
      required: ['location'],
    },
    run: async (call, args) => {
      const body = { location: args.location };
      if (args.name) Object.assign(body, { name: args.name, qty: args.quantity ?? 1, unit: args.unit || '' });
      else body.text = args.item;
      const { item } = await call('POST', '/api/pantry', body);
      return { added: true, ...pantryItem(item) };
    },
  },

  {
    name: 'update_pantry_item',
    title: 'Change a pantry item',
    description: 'Change the name, count, unit or shelf of something already in the kitchen. Send only what changes.',
    inputSchema: {
      type: 'object',
      properties: {
        itemId: { type: 'string' },
        name: { type: 'string' },
        quantity: { type: 'number', minimum: 0 },
        unit: { type: 'string' },
        location: LOCATION,
      },
      required: ['itemId'],
    },
    run: async (call, args) => {
      const body = {};
      if ('name' in args) body.name = args.name;
      if ('quantity' in args) body.qty = args.quantity;
      if ('unit' in args) body.unit = args.unit;
      if ('location' in args) body.location = args.location;
      const { item } = await call('PATCH', `/api/pantry/${encodeURIComponent(args.itemId)}`, body);
      return { updated: true, ...pantryItem(item) };
    },
  },

  {
    name: 'remove_pantry_item',
    title: 'Take something out of the pantry',
    description: 'Remove an item from the kitchen, because you used it up or it went off.',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' } },
      required: ['itemId'],
    },
    run: async (call, args) => {
      await call('DELETE', `/api/pantry/${encodeURIComponent(args.itemId)}`);
      return { removed: true, itemId: args.itemId };
    },
  },

  {
    name: 'add_grocery_item',
    title: 'Add to the grocery list',
    description:
      'Put something on the grocery list by hand: anything the meal plan wouldn’t know about. It sits alongside the week’s ingredients until it is removed.',
    inputSchema: {
      type: 'object',
      properties: {
        item: {
          type: 'string',
          description:
            'A whole line, e.g. "2 bags of ice" or "birthday candles". Several at once are read apart, so "milk, eggs and bread" adds three.',
        },
        section: SECTION,
      },
      required: ['item'],
    },
    run: async (call, args) => {
      const { items } = await call('POST', '/api/groceries', { text: args.item, section: args.section });
      return { added: items.length, items: items.map((i) => ({ itemId: i.id, text: i.text, section: i.section })) };
    },
  },

  {
    name: 'remove_grocery_item',
    title: 'Take something off the grocery list',
    description:
      'Remove a hand-added grocery item. Ingredients that come from the meal plan cannot be removed this way; change the plan or the pantry instead.',
    inputSchema: {
      type: 'object',
      properties: { itemId: { type: 'string' } },
      required: ['itemId'],
    },
    run: async (call, args) => {
      await call('DELETE', `/api/groceries/${encodeURIComponent(args.itemId)}`);
      return { removed: true, itemId: args.itemId };
    },
  },

  {
    name: 'grocery_list',
    title: 'Build a grocery list',
    description:
      'Everything to buy for a date range: the ingredients of every recipe planned in it (breakfast, lunch and dinner) minus anything already in the kitchen, plus whatever was added by hand. Each line carries the aisle it belongs to. Quantities are left exactly as the recipes write them; nothing is combined or converted.',
    inputSchema: {
      type: 'object',
      properties: {
        start: { type: 'string', description: 'First day, YYYY-MM-DD' },
        end: { type: 'string', description: 'Last day, YYYY-MM-DD (inclusive)' },
        ignorePantry: { type: 'boolean', description: 'List everything, including what you already have. Defaults to false.' },
      },
      required: ['start', 'end'],
    },
    run: async (call, args) => {
      const [{ entries }, { items: pantry }, { items: added }] = await Promise.all([
        call('GET', `/api/plan?start=${encodeURIComponent(args.start)}&end=${encodeURIComponent(args.end)}`),
        args.ignorePantry ? Promise.resolve({ items: [] }) : call('GET', '/api/pantry'),
        call('GET', '/api/groceries'),
      ]);
      const skipped = new Map();
      const planned = entries.flatMap((e) =>
        MEALS.flatMap((meal) => (e.meals[meal] || []).map((m) => ({ date: e.date, meal, m })))
      );
      const fromRecipes = planned
        .filter((x) => x.m.recipe)
        .map(({ date, meal, m }) => {
          const ingredients = m.recipe.ing
            // A section heading ("For the sauce:") names the lines under it
            .filter((line) => !isIngredientHeading(line))
            .filter((line) => {
              const have = pantrySkip(line, pantry);
              if (have) skipped.set(line, have.location);
              return !have;
            })
            .map((line) => ({ ingredient: line, section: grocerySection(line) }));
          return { date, meal, recipeId: m.recipe.id, title: m.recipe.title, servings: m.recipe.servings, ingredients };
        });
      // Meals that are takeout, leftovers or a plain note have no ingredients
      // but still belong in the answer, since they're meals you don't shop for.
      const noIngredients = planned
        .filter((x) => !x.m.recipe)
        .map(({ date, meal, m }) => ({ date, meal, planned: itemOf(m) }));
      return {
        start: args.start,
        end: args.end,
        sections: GROCERY_SECTIONS,
        itemCount: fromRecipes.reduce((n, r) => n + r.ingredients.length, 0) + added.length,
        recipes: fromRecipes,
        addedByHand: added.length
          ? added.map((i) => ({ itemId: i.id, item: i.text, section: i.section }))
          : undefined,
        // Named so it's obvious these were dropped on purpose, not missed
        alreadyInKitchen: skipped.size
          ? [...skipped].map(([ingredient, location]) => ({ ingredient, location }))
          : undefined,
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
  // A notification (no id) needs no reply; `initialized` is the common one
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
          'Pinch is a small, invite-only recipe collection shared between family and friends. ' +
          'Recipes belong to people: you can read and plan with anyone’s, but only edit your own. ' +
          'Dates are always YYYY-MM-DD in the planner, and each day has a breakfast, a lunch and a dinner, ' +
          'each of which can hold more than one thing. ' +
          'The pantry is what the member already has in the kitchen; the grocery list leaves those ingredients out, ' +
          'and anything added to the list by hand sits alongside the plan’s ingredients.',
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
        // Tool failures are results, not protocol errors, because the model should
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
 * Serve POST /mcp. `call(method, path, body)` runs one of our own API routes as
 * the caller's owner; `authed` says whether a valid key or access token was
 * presented; `resourceMetadata` is the URL an unauthenticated client should
 * read to find out how to get one.
 */
export async function handleMcp(request, { authed, call, resourceMetadata }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') {
    return json(fail(null, -32600, 'Send MCP requests as POST'), { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
  }
  if (!authed) {
    // RFC 9728: point at the metadata rather than just saying no. A client that
    // speaks OAuth follows this and connects itself; one that doesn't still has
    // a sentence telling a human what to paste.
    return json(fail(null, -32001, 'Not connected. Sign in through this server’s OAuth flow, or send an API key: Authorization: Bearer rb_…'), {
      status: 401,
      headers: {
        ...CORS,
        'www-authenticate': `Bearer resource_metadata="${resourceMetadata}"`,
      },
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
  // Notifications only, so nothing to say back
  if (!replies.length) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? replies : replies[0], { headers: CORS });
}
