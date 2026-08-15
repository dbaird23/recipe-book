# Recipe Book

A private, invite-only recipe book for family and friends. No feeds, no strangers — just your
recipes and your friends'.

Built from the Claude Design prototype (`Recipe Book.dc.html`).

## Features

- **My Recipes** — list or grid view, search, meal/tag filters, newest/A–Z sort
- **Add recipes three ways** — import from a URL (reads the site's schema.org recipe data, including
  photos, times, nutrition, and creator credit), paste the text and let it parse, or start from scratch
- **Recipe pages** — photo gallery, tap-to-check ingredients, numbered directions, personal notes,
  per-serving nutrition (auto-estimated, adjustable), and comments with photos
- **Friends** — each member has their own book; browse a friend's recipes, search across all friends,
  save any recipe into your own book (a snapshot copy — their later edits never touch yours)
- **Invite only** — the group admin creates single-use invite links to text to friends; new members
  automatically become friends with everyone in the book
- **Tags** — built-in meal/tag chips plus your own custom tags, reusable across recipes and filters
- **Google sign-in** — with a passwordless dev sign-in fallback for local development

## Stack

- `web/` — React 19 + Vite single-page app (mobile-first, matches the design system)
- `server/` — Express + better-sqlite3 API with session-cookie auth, photo uploads, and a
  schema.org/JSON-LD recipe importer

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:5173, sign in (dev mode), then optionally seed the demo data from the design
prototype (three demo friends and five starter recipes):

```bash
npm run seed
```

The first account to sign in becomes the group admin. Everyone else needs an invite link
(Friends → + Invite).

## Real Google sign-in

1. Create an OAuth **Web application** client at
   [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials)
2. Add `http://localhost:5173` to *Authorized JavaScript origins*
3. Copy `.env.example` to `.env` and set `GOOGLE_CLIENT_ID`

Dev sign-in stays available in development; in production (`NODE_ENV=production`) it's disabled
once a Google client ID is configured.

## Production

```bash
npm run build            # builds web/dist
NODE_ENV=production node server/src/index.js   # serves the API and the built app
```

Data lives in `server/data/` (SQLite) and uploaded photos in `server/uploads/` — back those up.

## Notes / deviations from the prototype

- **Invites** generate a real single-use link to copy or text yourself (no SMS gateway needed).
- **Share** copies a direct link to the recipe (friends already see your recipes) instead of the
  prototype's pick-a-friend sheet.
- **Nutrition** auto-estimates use the prototype's placeholder heuristic; imported recipes use the
  source site's published nutrition when available. Adjust by hand on any recipe.
- **List/grid view** is a per-device preference in the profile sheet (it was a canvas knob in the
  prototype).
- Recipes can be **deleted** from the edit screen (not in the prototype, but necessary in a real app).
