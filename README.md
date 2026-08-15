# Recipe Book

A private, invite-only recipe book for family and friends. No feeds, no strangers — just your
recipes and your friends'.

Built from the Claude Design prototype (`Recipe Book.dc.html`).

**[▶ Try the live demo](https://dbaird23.github.io/recipe-book/)** — a static build on GitHub Pages
that runs entirely in your browser with sample data (single-player; changes stay in your browser).
The real multi-user app runs on Cloudflare — see [Deploy](#deploy).

## Features

- **My Recipes** — list or grid view, search, meal/tag filters, newest/A–Z sort
- **Add recipes three ways** — import from a URL (reads the site's schema.org recipe data, including
  photos, times, nutrition, and creator credit), paste the text and let it parse, or start from scratch
- **Recipe pages** — photo gallery, tap-to-check ingredients, numbered directions, personal notes,
  per-serving nutrition (auto-estimated, adjustable), comments with photos, and a **1×–4× servings
  multiplier** that rescales ingredient quantities in place
- **Friends** — each member has their own book; browse a friend's recipes, search across all friends,
  save any recipe into your own book (a clean copy — no tags or comments carried over, credited to
  them, and independent of their later edits)
- **Invite only** — the group admin creates single-use invite links to text to friends; new members
  automatically become friends with everyone in the book
- **Tags** — built-in meal/tag chips plus your own custom tags, reusable across recipes and filters
- **Google sign-in** — with a passwordless dev sign-in fallback for local development

## Stack

- `web/` — React 19 + Vite single-page app (mobile-first, matches the design system)
- `worker/` — Cloudflare Worker API: **D1** (SQLite) for data, **R2** for photos, session-cookie auth
  with Google ID tokens verified via Web Crypto, and a schema.org/JSON-LD recipe importer

The Worker also serves the built SPA, so the whole app is one deployment on one origin.

## Local development

```bash
npm install
npm run dev
```

This runs `wrangler dev` (the real Worker, against a local D1 and R2) on :8787 and Vite on :5173
with the API proxied. Open http://localhost:5173.

First time, create the local database:

```bash
npx wrangler d1 migrations apply recipe-book --local
```

Sign in once (dev mode — no password), then optionally load the demo friends and starter recipes:

```bash
npm run seed
```

The first account to sign in becomes the group admin. Everyone else needs an invite link
(Friends → + Invite).

## Deploy

Everything below fits in Cloudflare's **free tier** (100k requests/day, 5 GB D1, 10 GB R2) — no card
required, no cold starts.

```bash
npx wrangler login     # opens your browser; create a free account if you don't have one
npm run setup          # creates the D1 database + R2 bucket, applies migrations
npm run deploy         # builds the SPA and deploys the Worker
```

`npm run setup` writes the new `database_id` into `worker/wrangler.jsonc` — commit that change.

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
| `npx wrangler d1 migrations apply recipe-book --remote` | Apply new migrations to production |

## Notes / deviations from the prototype

- **Invites** generate a real single-use link to copy or text yourself (no SMS gateway needed).
- **Share** copies a direct link to the recipe (friends already see your recipes) instead of the
  prototype's pick-a-friend sheet.
- **Nutrition** auto-estimates use the prototype's placeholder heuristic; imported recipes use the
  source site's published nutrition when available. Adjust by hand on any recipe. Note that editing a
  recipe re-runs the estimate unless the numbers were adjusted by hand.
- **List/grid view** is a per-device preference in the profile sheet (it was a canvas knob in the
  prototype).
- Recipes can be **deleted** from the edit screen (not in the prototype, but necessary in a real app).
- **URL import** depends on the site publishing schema.org recipe data, and some sites block
  server-side fetches outright. When that happens the app says so and points at "paste the text".
