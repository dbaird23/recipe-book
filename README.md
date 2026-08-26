# Recipe Book

A private, invite-only recipe book for family and friends. No feeds, no strangers, just your
recipes and your friends'.

Built from the Claude Design prototype (`Recipe Book.dc.html`).

**Live app:** [recipe-book.dbaird23.workers.dev](https://recipe-book.dbaird23.workers.dev):
invite only, running on Cloudflare Workers + D1 + R2.

**[▶ Try the demo](https://dbaird23.github.io/recipe-book/)** is a static build on GitHub Pages
that runs entirely in your browser with sample data (single-player; changes stay in your browser).

## Features

- **My Recipes**: list or grid view, search, meal/tag filters, newest/A–Z sort
- **Add recipes three ways**: import from a URL (reads the site's schema.org recipe data for times,
  nutrition and creator credit, and the page itself for the cook's notes and the step photos through
  the post), paste the text and let it parse, or start from scratch
- **Recipe pages**: photo gallery, tap-to-check ingredients, numbered directions, numbered notes,
  nutrition per serving (saying what a serving actually is, "5 meatballs with sauce", when the recipe
  does), comments with photos, and a **1×–4× servings multiplier** that rescales ingredient quantities
  in place
- **Ingredients in sections**: a recipe made of parts (the meatballs, and the sauce they sit in) says
  so with a line ending in a colon: "For the meatballs:". Everything under it becomes that section on
  the recipe page. The headings are labels, not shopping: they never reach the grocery list and never
  count toward the nutrition estimate
- **Pantry**: what you already keep in the pantry, fridge and freezer, typed *or dictated* the way
  you'd say it: "two cans of black beans, a bag of rice and three onions" lands as three items, spoken
  numbers and all, and the count can come after the thing too ("spaghetti 2 bags"). Counts step up and
  down right on the shelf, and each shelf folds away. The grocery list leaves those ingredients out and
  shows you what it skipped. **Take inventory** walks the shelves in one pass: cross out what's gone
  (the count stays put, so a mis-tap costs nothing), add whatever you find, and everything still crossed
  out drops off when you save
- **Plan**: a week at a time, with breakfast, lunch and dinner on every day. A meal holds as many
  things as it takes (spaghetti and meatballs is the meatball recipe plus a typed "spaghetti"), each
  one a recipe (yours or a friend's), "leftovers", or anything you type ("Takeout", "Date night"), plus
  a note for the day; clear one dish or the whole day in a tap. Any recipe can be put on the week
  from its own page, without going to the plan first
- **Groceries**: its own tab, built from the week's plan and laid out by aisle (produce, dairy,
  freezer…) rather than by day, so it's one walk through the shop. An ingredient several meals need
  is a single line that says how many recipes want it; tap the count to see which, or to open one.
  Add anything by hand and the aisle is read off the words rather than picked. Tick a line off with
  its box (it leaves the list and waits in "the trolley" at the bottom), tap its words to reword it
  for this shop, and swipe it left to drop it from the week altogether
- **Friends**: each member has their own book; browse a friend's recipes, search across all friends,
  save any recipe into your own book (a clean copy: no tags or comments carried over, credited to
  them, and independent of their later edits)
- **Invite only**: the group admin creates single-use invite links to text to friends; new members
  automatically become friends with everyone in the book
- **Tags**: built-in meal/tag chips plus your own custom tags, reusable across recipes and filters
- **Google sign-in**, with a passwordless dev sign-in fallback for local development
- **AI & API access**: each member can issue API keys and point an AI assistant (Cursor, Claude,
  anything that speaks MCP) at their recipes, pantry and meal plan. See below

## Stack

- `web/`: React 19 + Vite single-page app (mobile-first, matches the design system)
- `worker/`: Cloudflare Worker API: **D1** (SQLite) for data, **R2** for photos, session-cookie auth
  with Google ID tokens verified via Web Crypto, and a schema.org/JSON-LD recipe importer

The Worker also serves the built SPA, so the whole app is one deployment on one origin.

## AI & API access

Members can hand an AI assistant a key to their own book, which is useful for meal planning and grocery
shopping, where the assistant needs to actually read your recipes rather than invent them.

**Get a key:** tap your avatar → *Connected apps* → **Give an AI assistant access**. Name it, create
it, and copy the token. It's shown once and stored only as a SHA-256 hash, so a lost key gets
replaced, not recovered. Revoke any key from the same sheet; it stops working immediately.

### Connect Cursor

The create-key screen prints this config with your URL and token already filled in. Paste it into
`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project) and restart Cursor:

```json
{
  "mcpServers": {
    "recipe-book": {
      "url": "https://recipe-book.dbaird23.workers.dev/mcp",
      "headers": { "Authorization": "Bearer rb_your_key_here" }
    }
  }
}
```

Any MCP client works the same way. The endpoint is Streamable HTTP at `POST /mcp`, stateless, with
the key in an `Authorization: Bearer` header.

### Tools

| Tool | What it does |
|---|---|
| `whoami` | Which account the key belongs to; handy for checking the connection |
| `list_recipes` | Summaries of your recipes, your friends', or both, with an optional search |
| `get_recipe` | One recipe in full: ingredients, directions, notes, nutrition, comments |
| `create_recipe` | Add a recipe to your book |
| `update_recipe` | Change a recipe you own; send only the fields you want changed |
| `import_recipe_from_url` | Parse a recipe off a web page, optionally saving it straight away |
| `get_meal_plan` | What's planned to eat across a date range: breakfast, lunch and dinner |
| `set_meal_plan_day` | Set or clear any of one day's meals (one thing or several) and its note |
| `get_pantry` | What's already in the kitchen: pantry, fridge and freezer |
| `add_pantry_item` | Put something in the kitchen, from a typed line or explicit fields |
| `update_pantry_item` | Change an item's name, count, unit or shelf |
| `remove_pantry_item` | Take something out, used up or gone off |
| `grocery_list` | Everything to buy for a date range: the planned recipes' ingredients minus what the pantry covers, plus hand-added items, each tagged with its aisle |
| `add_grocery_item` | Put something on the grocery list by hand |
| `remove_grocery_item` | Take a hand-added item off the list |

The tools call the same route handlers the web app does, so permissions and validation can't drift
between the two.

### REST

The same key works against the REST API for anything that isn't MCP:

```bash
curl https://recipe-book.dbaird23.workers.dev/api/recipes \
  -H "Authorization: Bearer rb_your_key_here"
```

Open to keys: `GET /api/me`, `GET|POST /api/recipes`, `GET|PATCH /api/recipes/:id`,
`POST /api/recipes/:id/save`, `GET /api/friends`, `GET /api/friends/recipes`,
`GET /api/friends/:id/recipes`, `GET|PUT /api/plan`, `POST /api/import`.

**Deliberately not open to keys:** deleting recipes, comments and photos, invites, avatars, and
issuing or listing keys. Those need a signed-in browser, so a leaked key can't lose you data or let
anyone else into the book. Every other route answers `403` to a key.

## Local development

```bash
npm install
npm run dev
```

This runs `wrangler dev` (the real Worker, against a local D1 and R2) on :8787 and Vite on :5173
with the API proxied. Open http://localhost:5173.

First time, create the local database:

```bash
npm run migrate:local -w worker
```

Google sign-in is configured, so `wrangler dev` requires it locally too. To get the
passwordless dev sign-in back on localhost, create `worker/.dev.vars` (git-ignored):

```
GOOGLE_CLIENT_ID=""
```

Sign in once (dev mode, no password), then optionally load the demo friends and starter recipes:

```bash
npm run seed
```

The first account to sign in becomes the group admin. Everyone else needs an invite link
(Friends → + Invite).

To run the front end on its own against the sample data (the same build that's on GitHub Pages: no
Worker, no database, no sign-in), use `npm run demo -w web` and open http://localhost:5175.

## Deploy

Everything below fits in Cloudflare's **free tier** (100k requests/day, 5 GB D1, 10 GB R2), with no card
required, no cold starts.

```bash
npx wrangler login     # opens your browser; create a free account if you don't have one
npm run setup          # creates the D1 database + R2 bucket, applies migrations
npm run deploy         # builds the SPA and deploys the Worker
```

`npm run setup` writes the new `database_id` into `worker/wrangler.jsonc`. Commit that change.

Your app is live at `https://recipe-book.<your-subdomain>.workers.dev`.

### Turn on Google sign-in

1. Create an OAuth **Web application** client at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Add your Worker URL (and `http://localhost:5173` for local use) to *Authorized JavaScript origins*
3. Put the client ID in `worker/wrangler.jsonc` under `vars.GOOGLE_CLIENT_ID` and redeploy

The client ID is public, so it belongs in the config file rather than in a secret. Setting it also
disables the dev sign-in fallback.

### Useful commands

| Command | What it does |
|---|---|
| `npm run deploy` | Build the SPA and deploy the Worker |
| `npm run seed -- --remote` | Seed demo data into the deployed database |
| `npm run tail` | Live-tail production logs |
| `npm run migrate -w worker` | Apply new migrations to production |
| `npm run migrate:local -w worker` | Apply new migrations to the local dev database |

Wrangler reads its config from `worker/wrangler.jsonc`, so the raw `npx wrangler …` commands only
work from inside `worker/`. The npm scripts above run from anywhere in the repo.

## Notes / deviations from the prototype

- **Invites** generate a real single-use link to copy or text yourself (no SMS gateway needed).
- **Share** copies a direct link to the recipe (friends already see your recipes) instead of the
  prototype's pick-a-friend sheet.
- **Nutrition** auto-estimates use the prototype's placeholder heuristic. Nutrition that came from an
  import or a paste is treated as real data, so editing the recipe won't overwrite it; a recipe with
  only estimated numbers re-estimates when its ingredients change.
- **List/grid view** is a per-device preference in the profile sheet (it was a canvas knob in the
  prototype).
- Recipes can be **deleted** from the edit screen (not in the prototype, but necessary in a real app).
- **Ingredient sections** are a convention inside the ingredients rather than a second field: a short
  line that ends in a colon and doesn't lead with a quantity is a heading. That leaves ordinary lines
  alone ("2 tbsp soy sauce" leads with a number, "Sauce: 2 tbsp soy sauce" doesn't end with the
  colon), it survives a paste or an import unchanged, and a recipe written without headings looks
  exactly as it always did. `web/src/util.js` and `worker/src/util.js` keep the same rule.
- **Saving an edit** happens from a bar pinned to the bottom of the add/edit screen, since a recipe
  written in sections is a long enough form that the button would otherwise be a scroll away.
- **Servings** are worked out from what the recipe says it yields. A yield is often a count of things
  rather than of meals ("about 35 meatballs" is not 35 dinners), so when the nutrition says what one
  serving is in the same units ("5 meatballs with sauce"), the two are divided into each other and
  that recipe correctly serves seven. With nothing to divide by, the count stands, which is the right
  answer for the "12 cookies" kind of yield anyway. Pasted recipes read the same way.
- **URL import** depends on the site publishing schema.org recipe data, and some sites block
  server-side fetches outright. When that happens the app says so and points at "paste the text".
  Notes and the step photos aren't in that data at all, so they're read out of the page's markup:
  the wrappers the common recipe-card plugins use for notes, and the images inside the article,
  minus the logos, headshots and Pinterest graphics. A site that lays either out in a way the
  importer doesn't recognise simply comes back without them; everything is editable on the review
  screen either way.
- **Ticks, hand-struck lines and rewordings on the grocery list** live in the browser, filed under
  the week they belong to, so a shop doesn't need a round trip in an aisle and last week's list can't
  hide this week's flour. Striking a planned ingredient off only hides it for that week, and
  rewording one lays your words over the recipe's rather than editing it; the recipe still calls for
  what it calls for.
- **AI & API access** isn't in the prototype at all. It exists so an assistant can plan meals and
  build a shopping list against the real book instead of guessing.
