export const MEALS = ['Breakfast', 'Lunch', 'Dinner', 'Side', 'Dessert'];
export const TAGS = ['Vegetarian', 'Crockpot', 'Quick', 'Low calorie', 'High protein', 'Chicken', 'Beef', 'Christmas'];

export const SAMPLE_PASTE =
  'Lemon Herb Salmon\n\nPrep: 10 min\nCook: 15 min\nServes 2\n\nIngredients\n2 salmon fillets (6 oz each)\n1 lemon, sliced\n2 tbsp olive oil\n2 cloves garlic, minced\n1 tsp dried dill\nSalt and pepper\n\nDirections\nPreheat oven to 400°F and line a baking sheet with parchment.\nRub salmon with olive oil, garlic, dill, salt and pepper.\nTop with lemon slices and bake 12–15 minutes until flaky.\nRest 2 minutes and serve.';

const AVATAR_COLORS = ['#b5543b', '#8a6d4f', '#4a6b8a', '#7d5a7d', '#5a7d7d', '#a8824a'];

export function avatarColor(user) {
  if (!user) return '#ccc';
  let h = 0;
  for (const ch of user.id || user.name || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function metaOf(r) {
  const t = (r.prep || 0) + (r.cook || 0);
  const time = t >= 60 ? (t % 60 ? `${Math.floor(t / 60)} hr ${t % 60} min` : `${Math.floor(t / 60)} hr`) : `${t} min`;
  return `${time} · ${r.servings}${r.servings === 1 ? ' serving' : ' servings'}${r.from ? ` · from ${r.from}` : ''}`;
}

export function autoNut(ingCount) {
  const n = ingCount;
  return { cal: 160 + n * 38, pro: 4 + n * 4, carb: 10 + n * 5, fat: 4 + n * 3 };
}

// Parse a pasted block of recipe text (same rules as the design prototype).
export function parseText(text) {
  const lines = text.split('\n').map((l) => l.trim());
  let title = '', prep = '', cook = '', serv = '';
  const ing = [], dir = [];
  let mode = 'head';
  for (const l of lines) {
    if (!l) continue;
    const low = l.toLowerCase();
    let m;
    if ((m = low.match(/prep[^0-9]*([0-9]+)/))) { prep = m[1]; continue; }
    if ((m = low.match(/cook[^0-9]*([0-9]+)/)) && low.indexOf('cook') === 0) { cook = m[1]; continue; }
    if ((m = low.match(/(serves|servings?)[^0-9]*([0-9]+)/))) { serv = m[2]; continue; }
    if (/^ingredients\b/.test(low)) { mode = 'ing'; continue; }
    if (/^(directions|instructions|steps|method)\b/.test(low)) { mode = 'dir'; continue; }
    if (mode === 'head') {
      if (!title) title = l;
      else ing.push(l);
      continue;
    }
    if (mode === 'ing') ing.push(l);
    else dir.push(l.replace(/^\d+[.)]\s*/, ''));
  }
  return { title, prep, cook, serv, ing: ing.join('\n'), dirs: dir.join('\n') };
}

// Tags people created themselves, beyond the built-in meal/tag chips
export function customTagsFrom(recipes) {
  const standard = new Set([...MEALS, ...TAGS]);
  const found = new Set();
  for (const r of recipes) for (const t of r.tags) if (!standard.has(t)) found.add(t);
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function matchesFilters(r, { selMeals, selTags, query }) {
  const q = query.trim().toLowerCase();
  const matchQ = !q || r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q));
  return (
    (selMeals.length === 0 || selMeals.some((m) => r.tags.includes(m))) &&
    (selTags.length === 0 || selTags.some((t) => r.tags.includes(t))) &&
    matchQ
  );
}

export function sortRecipes(list, sort) {
  return sort === 'alpha' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : list;
}
