# Pinch

A private, invite-only recipe book for family and friends. No feeds, no strangers, just your
recipes and your friends'.

Built from the Claude Design prototype (`Recipe Book.dc.html`).

**Live app:** [recipe-book.dbaird23.workers.dev](https://recipe-book.dbaird23.workers.dev):
invite only, running on Cloudflare Workers + D1 + R2.

## Features

- **My Recipes**: list or grid view, search, meal/tag filters, newest/A–Z sort
- **Add recipes four ways**: import from a URL (reads the site's schema.org recipe data for times,
  nutrition and creator credit, and the page itself for the cook's notes and the step photos through
  the post; a link shared out of **MealBoard** is read as the recipe file it is, categories and all,
  one recipe per link), **photograph it** (see below), paste the text and let it parse, or start
  from scratch
- **Photograph a recipe**: point the camera at a cookbook page, a handwritten card or a clipping and
  it comes back as a filled-in draft — title, times, ingredients (sections and all), steps, notes, and
  the printed nutrition if there is any. Up to four photos when the recipe runs over the page, read as
  one recipe. The photo you took is kept as the recipe's photo unless you drop it on the review screen.
  What can't be read is left blank rather than guessed at, and every draft lands on that review screen
  before it's saved, because a misread quantity looks exactly like a right one once it's in the book.
  An AI assistant can do the same through the `read_recipe_from_photo` MCP tool
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
  down right on the shelf, and each shelf folds away. Ingredients coming off the plan skip whatever
  the shelves already cover, and the count of what was skipped is reported back. Tap any item's words to reword it. **Take inventory** walks the shelves in
  one pass: cross out what's gone with its box (the count stays put, so a mis-tap costs nothing), add
  whatever you find, reword anything that reads wrong, and everything still crossed out drops off when
  you save
- **Plan**: a week at a time, with breakfast, lunch and dinner on every day. A meal holds as many
  things as it takes (spaghetti and meatballs is the meatball recipe plus a typed "spaghetti"), each
  one a recipe (yours or a friend's), "leftovers", or anything you type ("Takeout", "Date night"), plus
  a note for the day; clear one dish or the whole day in a tap. Any recipe can be put on the week
  from its own page, without going to the plan first
- **Groceries**: one list, not a week's, laid out by aisle (produce, dairy, freezer…) rather than by
  day, so it's one walk through the shop. It's a real list rather than a view of the plan: when the
  week looks right, **Add ingredients to grocery list** on the plan puts everything it calls for onto
  it, minus what the pantry already covers and what the list already has, and tells you what it left
  off. Safe to press again after changing your mind about Thursday: it tops the list up rather than
  rebuilding it, so nothing you've ticked, reworded or deleted comes back. An ingredient several
  meals need is a single line that says how many; tap the count to see which, or to open one. Add
  anything by hand, in a run if you like ("milk, eggs and bread" is three lines), and the aisle is
  read off the words rather than picked. Tick a line off with its box (it leaves the list and waits
  in "the trolley" at the bottom), tap its words to reword it, and swipe it left to drop it. At the
  till, **Start a new shop** takes everything in the trolley off the list for good
- **Friends**: each member has their own book; browse a friend's recipes, search across all friends,
  save any recipe into your own book (a clean copy: no tags or comments carried over, credited to
  them, and independent of their later edits)
- **Invite only**: the group admin creates single-use invite links to text to friends; new members
  automatically become friends with everyone in the book
- **Tags**: built-in meal/tag chips plus your own custom tags, reusable across recipes and filters
- **Works without a signal**: once it has opened on a phone, it opens again in a cabin or a
  basement supermarket, on the copy of the book it last saw. Recipes, the plan for any week that's
  been looked at, the pantry and the grocery list all read; ticks, new lines, rewordings, pantry
  counts, plan changes, ratings, notes and new or edited recipes are kept on the phone and sent
  when the connection returns, in the order they were made. A line across the top says which of
  those is going on. Photos, imports, saving a friend's recipe and signing in need the connection
- **Google sign-in**, with a passwordless dev sign-in fallback for local development
- **AI & API access**: each member can point an AI assistant at their own recipes, pantry and meal
  plan. **ChatGPT** connects itself: add the connector, sign in, say yes. **Cursor, Claude and
  anything else that speaks MCP** take an API key instead. See below

## Stack

- `web/`: React 19 + Vite single-page app (mobile-first, matches the design system)
- `worker/`: Cloudflare Worker API: **D1** (SQLite) for data, **R2** for photos, session-cookie auth
  with Google ID tokens verified via Web Crypto, a schema.org/JSON-LD recipe importer, and Claude
  (`@anthropic-ai/sdk`) for reading a recipe off a photograph

The Worker also serves the built SPA, so the whole app is one deployment on one origin.

## AI & API access

Members can point an AI assistant at their own book, which is useful for meal planning and grocery
shopping, where the assistant needs to actually read your recipes rather than invent them.

It's one MCP server, at `POST /mcp`, reached two ways depending on what the client can hold:

| | How it signs in | Who it's for |
|---|---|---|
| **OAuth** | The client sends you here to sign in and say yes | ChatGPT, and anything else with no place to put a key |
| **API key** | A token you paste into a config file | Cursor, Claude Desktop, scripts, `curl` |

Both land in the same place with the same permissions. Everything is managed from one screen: tap
your avatar → *Connected apps* → **Give an AI assistant access**.

### Connect ChatGPT

ChatGPT's custom connectors have nowhere to put an API key, so it does OAuth instead. There is
nothing to copy but the address:

1. In ChatGPT on the web: **Settings → Security and login → Developer mode**.
2. Open **Plugins**, press **+**, and point it at `https://recipe-book.dbaird23.workers.dev/mcp`,
   with **OAuth** for authentication.
3. ChatGPT opens Pinch. Check the account on the consent screen is yours, and press **Allow**.
4. The app waits under **Drafts**, and turns up in a chat under the composer's *Developer mode* tool.

That's it: no key, no config file, and nothing to paste back. ChatGPT registers itself, so it never
needs to be set up on this end either.

Developer mode is web only, and needs Plus, Pro, Business, Enterprise or Edu; on a Business or
Enterprise workspace an admin has to allow custom MCP connectors before the toggle appears at all.

> OpenAI has moved this twice — it used to be *Connectors → Advanced*, and connectors are now called
> plugins. If the menu doesn't match, the address and the OAuth flow are still right; only their
> wording has moved.

Each connection shows up under *Connected apps* with when it was made and last used, and
**Disconnect** kills it and every token it holds on the spot.

**What actually happens.** ChatGPT calls `/mcp` cold, gets a `401` pointing at
`/.well-known/oauth-protected-resource`, and takes itself from there:

- `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server`
  (RFC 8414) say what the API is and who issues tokens for it
- `POST /oauth/register` registers the client (RFC 7591). Public clients only: no secrets are issued,
  so there are none to leak
- `GET /oauth/authorize` checks the request and hands the browser to `/connect`, which is a screen in
  the app rather than a second login page. Whoever is signed in *in that browser* is the account
  being connected, which is what makes it safe to do on a shared laptop
- `POST /oauth/token` swaps the code for an access token (an hour) and a refresh token (90 days),
  with PKCE `S256` required and refresh tokens rotated on every use
- `POST /oauth/revoke` (RFC 7009) for a client that wants to hand a token back

Codes and tokens are stored only as SHA-256 hashes, a code is single-use, and a token is bound to
the server that issued it.

### Connect Cursor, Claude Desktop or a script

**Get a key:** from the same sheet, name it under *New key*, create it, and copy the token. It's
shown once and stored only as a SHA-256 hash, so a lost key gets replaced, not recovered. Revoke any
key from the same sheet; it stops working immediately.

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

### Add to the grocery list by voice

A shortcut, since there's no app for Siri to talk to. In **Shortcuts** on an iPhone, make one named
**Add to grocery list** (the name is the phrase Siri listens for) with two actions:

1. **Dictate Text**.
2. **Get Contents of URL** on `https://recipe-book.dbaird23.workers.dev/api/groceries`, Method
   **POST**, one header `Authorization: Bearer rb_your_key_here`, and a **JSON** request body with a
   single field `text` set to **Dictated Text**.

Then: "Hey Siri, add to grocery list." A breath's worth of items goes in at once, because the route
reads one line as the run of items it may be: "milk, eggs and bread" lands as three, each filed into
its own aisle. Splitting on "and" occasionally cuts an item in half ("bread and butter pickles"),
the same trade the pantry makes, and the same one it's forgiven for: every line stays editable and
removable on the list.

The steps are printed with the address and header already filled in on the screen that shows a new
key, which is the one moment the token is in hand.

### Tools

| Tool | What it does |
|---|---|
| `whoami` | Which account the key belongs to; handy for checking the connection |
| `list_recipes` | Summaries of your recipes, your friends', or both, with an optional search |
| `get_recipe` | One recipe in full: ingredients, directions, notes, nutrition, comments |
| `create_recipe` | Add a recipe to your book |
| `update_recipe` | Change a recipe you own; send only the fields you want changed |
| `import_recipe_from_url` | Parse a recipe off a web page, optionally saving it straight away |
| `read_recipe_from_photo` | Transcribe a recipe from a photo of a page or card (send it as base64), optionally saving it straight away |
| `get_meal_plan` | What's planned to eat across a date range: breakfast, lunch and dinner |
| `set_meal_plan_day` | Set or clear any of one day's meals (one thing or several) and its note |
| `get_pantry` | What's already in the kitchen: pantry, fridge and freezer |
| `add_pantry_item` | Put something in the kitchen, from a typed line or explicit fields |
| `update_pantry_item` | Change an item's name, count, unit or shelf |
| `remove_pantry_item` | Take something out, used up or gone off |
| `grocery_list` | What's on the grocery list now, in aisle order, each line saying which meals asked for it |
| `add_plan_to_grocery_list` | Put everything the plan calls for over a date range onto the list, minus what the pantry covers and what's already there |
| `add_grocery_item` | Put something on the grocery list by hand, or several in one line |
| `remove_grocery_item` | Take an item off the list |

The tools call the same route handlers the web app does, so permissions and validation can't drift
between the two.

`read_recipe_from_photo` needs `ANTHROPIC_API_KEY` set (see [Turn on photographing
recipes](#turn-on-photographing-recipes)); without it the tool is still listed but says the book
isn't set up for it. Send the picture as base64 or as a `data:` URL — the format is read from the
bytes, so a wrong label does no harm — and up to four photos of *one* recipe that runs over the page.
The photo is only read, never kept with the recipe: adding photos to a recipe stays off-limits to
API keys, as it always has been.

### REST

The same credential — key or OAuth access token — works against the REST API for anything that isn't
MCP:

```bash
curl https://recipe-book.dbaird23.workers.dev/api/recipes \
  -H "Authorization: Bearer rb_your_key_here"
```

Open to keys: `GET /api/me`, `GET|POST /api/recipes`, `GET|PATCH /api/recipes/:id`,
`POST /api/recipes/:id/save`, `GET /api/friends`, `GET /api/friends/recipes`,
`GET /api/friends/:id/recipes`, `GET|PUT /api/plan`, `POST /api/import`,
`GET|POST|PUT /api/pantry`, `PATCH|DELETE /api/pantry/:id`, `GET|POST /api/groceries`,
`PATCH|DELETE /api/groceries/:id`, `POST /api/groceries/from-plan`,
`POST /api/groceries/clear`.

**Deliberately not open to keys or OAuth tokens:** deleting recipes, comments and photos, invites,
avatars, issuing or listing keys, and granting access to another app. Those need a signed-in browser,
so a leaked credential can't lose you data, let anyone else into the book, or quietly grant itself a
second way in. Every other route answers `403`.

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

To photograph recipes locally, add your Anthropic API key to the same file:

```
ANTHROPIC_API_KEY=sk-ant-…
```

Without it the camera is simply hidden — the link, paste and from-scratch routes are unaffected.

Sign in once (dev mode, no password), then optionally load the sample friends and starter recipes:

```bash
npm run seed
```

The first account to sign in becomes the group admin. Everyone else needs an invite link
(Friends → + Invite).

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

### Turn on photographing recipes

Reading a recipe off a photograph asks Claude to transcribe it, so it needs an API key from
[console.anthropic.com](https://console.anthropic.com):

```bash
npx wrangler secret put ANTHROPIC_API_KEY   # from worker/
```

It's a secret rather than a `vars` entry, so it never lands in the config file or the client bundle.
`/api/config` reports only whether one is set, and the camera appears only when it is. A scan costs
a fraction of a cent; nothing else in the app calls the API.

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
| `npm run seed -- --remote` | Seed sample data into the deployed database |
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
- **Ticks on the grocery list** live in the browser, so a shop doesn't need a round trip while
  you're standing in an aisle with one bar of signal. Everything else about the list is stored:
  a line put there from the plan remembers the meals that asked for it and the key it was matched
  on, so rewording it for the shop ("2 lb chicken thighs, boneless" is not how you buy them) doesn't
  make the next push think it's missing and put the recipe's wording back beside it.
- **AI & API access** isn't in the prototype at all. It exists so an assistant can plan meals and
  build a shopping list against the real book instead of guessing.
