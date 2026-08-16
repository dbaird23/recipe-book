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

/** 65 → "1 hr 5 min", 120 → "2 hr", 40 → "40 min" */
export function formatMinutes(m) {
  const t = Math.max(0, Math.round(m || 0));
  if (t < 60) return `${t} min`;
  const h = Math.floor(t / 60);
  return t % 60 ? `${h} hr ${t % 60} min` : `${h} hr`;
}

export function metaOf(r) {
  const time = formatMinutes((r.prep || 0) + (r.cook || 0));
  return `${time} · ${r.servings}${r.servings === 1 ? ' serving' : ' servings'}${r.from ? ` · from ${r.from}` : ''}`;
}

export function autoNut(ingCount) {
  const n = ingCount;
  return { cal: 160 + n * 38, pro: 4 + n * 4, carb: 10 + n * 5, fat: 4 + n * 3 };
}

// --- pasted-recipe parsing ---

const SECTIONS = [
  [/^(ingredients|what you.?ll need)\b/i, 'ing'],
  [/^(directions|instructions|steps|method|preparation|how to make)\b/i, 'dir'],
  [/^(notes?|tips?|cook.?s notes?|recipe notes?)\b/i, 'notes'],
  [/^(nutrition|nutritional|per serving)\b/i, 'nut'],
];

// "1 hr 20 min" → 80, "15 minutes" → 15, "30" → 30
function minutesOf(s) {
  const h = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/i.exec(s);
  const m = /(\d+)\s*(?:minutes?|mins?|m)\b/i.exec(s);
  let total = 0;
  if (h) total += Math.round(parseFloat(h[1]) * 60);
  if (m) total += +m[1];
  if (!h && !m) {
    const n = /(\d+)/.exec(s);
    if (n) total = +n[1];
  }
  return total || '';
}

const NUT_FIELDS = [
  ['cal', /(?:calories|kcal)/i],
  ['pro', /protein/i],
  ['carb', /(?:carbohydrates?|carbs?)/i],
  ['fat', /(?:total\s+)?fat/i],
];

/** Pull calories/protein/carbs/fat out of a nutrition blob, in any order or layout. */
function parseNutrition(text) {
  if (!text.trim()) return null;
  const out = {};
  let found = 0;
  for (const [key, kw] of NUT_FIELDS) {
    // "Protein: 28g" or "28g protein"
    const after = new RegExp(kw.source + '\\s*[:\\-]?\\s*([\\d.]+)', 'i').exec(text);
    const before = new RegExp('([\\d.]+)\\s*(?:g|mg|kcal)?\\s*(?:of\\s+)?' + kw.source, 'i').exec(text);
    const raw = after?.[1] ?? before?.[1];
    if (raw != null) {
      out[key] = Math.round(parseFloat(raw)) || 0;
      found++;
    }
  }
  return found ? { cal: 0, pro: 0, carb: 0, fat: 0, ...out } : null;
}

// Deliberately narrow: a leading quantity, or a short line naming a staple.
// Anything looser swallows the description paragraph that often sits up top.
const looksLikeIngredient = (l) =>
  /^[\d¼½¾⅓⅔⅛⅜⅝⅞]/.test(l) ||
  (l.length <= 40 && /^(salt|pepper|pinch|dash|olive oil|butter|water|ice|juice|zest)\b/i.test(l));

const stripBullet = (l) => l.replace(/^[-–—•*·]\s*/, '');
const stripNumber = (l) => l.replace(/^\(?\d+[.)\]]\s+/, '');

/**
 * Parse a pasted recipe into its parts. Recognises labelled sections
 * (Ingredients / Directions / Notes / Nutrition) and falls back to shape
 * heuristics when the paste has no headings.
 */
export function parseText(text) {
  const lines = text.split('\n').map((l) => l.trim());
  let title = '', prep = '', cook = '', serv = '';
  const ing = [], dir = [], notes = [], nut = [];
  let mode = 'head';

  for (const raw of lines) {
    if (!raw) continue;
    const l = stripBullet(raw);
    const low = l.toLowerCase();

    const section = SECTIONS.find(([re]) => re.test(low));
    if (section) {
      mode = section[1];
      // Allow "Nutrition: 350 cal, 20g protein" on the heading line itself
      const inline = l.slice(l.match(section[0])[0].length).replace(/^[:\-–]\s*/, '');
      if (inline && mode === 'nut') nut.push(inline);
      continue;
    }

    let m;
    if ((m = low.match(/^(?:total\s+)?prep(?:aration)?\s*(?:time)?\s*[:\-]?\s*(.+)/))) { prep = minutesOf(m[1]); continue; }
    if ((m = low.match(/^cook(?:ing)?\s*(?:time)?\s*[:\-]?\s*(.+)/))) { cook = minutesOf(m[1]); continue; }
    if ((m = low.match(/^(?:serves|servings?|yields?|makes)\s*[:\-]?\s*(\d+)/))) { serv = m[1]; continue; }
    if ((m = low.match(/^total\s*time\s*[:\-]?\s*(.+)/))) { if (!cook) cook = minutesOf(m[1]); continue; }

    if (mode === 'head') {
      if (!title) title = l;
      else if (looksLikeIngredient(l)) { mode = 'ing'; ing.push(l); }
      else notes.push(l); // a description paragraph before any heading
      continue;
    }
    if (mode === 'ing') ing.push(l);
    else if (mode === 'dir') dir.push(stripNumber(l));
    else if (mode === 'notes') notes.push(l);
    else if (mode === 'nut') nut.push(l);
  }

  return {
    title,
    prep,
    cook,
    serv,
    ing: ing.join('\n'),
    dirs: dir.join('\n'),
    notes: notes.join('\n'),
    nut: parseNutrition(nut.join('\n')),
  };
}

// ---- meal plan weeks (Monday-start, local time) ----

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** The meals of a planned day, in the order they're eaten. Mirrors worker/src/util.js. */
export const MEAL_SLOTS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'lunch', label: 'Lunch' },
  { key: 'dinner', label: 'Dinner' },
];

/** Monday of the week `offset` weeks from the current one. */
export function mondayOf(offset = 0) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday avoids DST edges shifting the date
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d;
}

export const addDays = (date, n) => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

/** Local YYYY-MM-DD — not toISOString(), which converts to UTC and can slip a day. */
export const isoDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const shortDate = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const isToday = (d) => isoDate(d) === isoDate(new Date());

export function weekTitle(offset) {
  if (offset === 0) return 'This week';
  if (offset === 1) return 'Next week';
  if (offset === -1) return 'Last week';
  return offset > 0 ? `In ${offset} weeks` : `${Math.abs(offset)} weeks ago`;
}

// ---- pantry ----

export const PANTRY_LOCATIONS = [
  { key: 'pantry', label: 'Pantry' },
  { key: 'fridge', label: 'Fridge' },
  { key: 'freezer', label: 'Freezer' },
];

/** "2 heads", "1 bottle", "3" — the count as it reads on a shelf label. */
export const qtyLabel = (qty, unit) => `${+(+qty).toFixed(2)}${unit ? ` ${unit}` : ''}`;

/** How an item reads when you tap it to edit: "2 heads Garlic", or just "Parmesan". */
export const pantryLine = (item) =>
  item.qty !== 1 || item.unit ? `${qtyLabel(item.qty, item.unit)} ${item.name}` : item.name;

// Words the demo backend lifts out of "2 cans black beans" as the unit —
// anything else after the number is part of the name. The real backend parses
// server-side; this copy exists so the static demo behaves the same.
const PANTRY_UNITS = new Set([
  'can', 'cans', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'box', 'boxes', 'bag', 'bags',
  'package', 'packages', 'pkg', 'jar', 'jars', 'bottle', 'bottles', 'pack', 'packs',
  'dozen', 'head', 'heads', 'stick', 'sticks', 'bunch', 'bunches', 'gallon', 'quart',
  'loaf', 'loaves', 'carton', 'cartons', 'container', 'containers', 'block', 'blocks',
]);

/** "2 cans black beans" → 2 × "black beans" in cans. Mirrors worker/src/util.js. */
export function parsePantryEntry(text) {
  const v = String(text ?? '').trim();
  const hadQty = /^\d/.test(v);
  const m = v.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s+(.+)$/);
  if (!m) return { name: v, qty: 1, unit: '', hadQty };
  const unit = (m[2] || '').toLowerCase();
  if (m[2] && PANTRY_UNITS.has(unit)) return { name: m[3].trim(), qty: parseFloat(m[1]), unit, hadQty };
  return { name: (m[2] ? `${m[2]} ` : '') + m[3].trim(), qty: parseFloat(m[1]), unit: '', hadQty };
}

/**
 * The pantry item that covers an ingredient line, or null. "Kidney beans"
 * covers "2 cans kidney beans, drained". Deliberately loose and blind to a
 * trailing plural: a wrong skip costs one trip down an aisle, and the grocery
 * sheet lists every skip back to you. Names under three characters never
 * match — too many false hits. The Worker keeps the same rule for the MCP
 * grocery list, in worker/src/util.js.
 */
export function pantrySkip(text, items) {
  const t = String(text).toLowerCase();
  return items.find((it) => {
    const name = it.name.toLowerCase().replace(/s$/, '');
    return name.length > 2 && t.includes(name);
  }) || null;
}

// ---- ingredient scaling (1×–4× view on the recipe page) ----

const UNI_FRAC = {
  '¼': 1 / 4, '½': 1 / 2, '¾': 3 / 4, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅕': 1 / 5, '⅖': 2 / 5, '⅗': 3 / 5, '⅘': 4 / 5, '⅙': 1 / 6,
  '⅛': 1 / 8, '⅜': 3 / 8, '⅝': 5 / 8, '⅞': 7 / 8,
};
const NICE_FRACS = Object.entries(UNI_FRAC).map(([ch, v]) => [v, ch]);
const UNI_CHARS = Object.keys(UNI_FRAC).join('');

// A quantity: "2", "1.5", "1/2", "½", "1½", "1 1/2", "1 and 1/2"
const QTY = `(?:\\d+\\s*\\/\\s*\\d+|\\d+(?:\\.\\d+)?(?:\\s*(?:and\\s+)?(?:\\d+\\s*\\/\\s*\\d+|[${UNI_CHARS}]))?|[${UNI_CHARS}])`;
const LEADING_QTY = new RegExp(`^(${QTY})(\\s*(?:-|–|—|\\bto\\b)\\s*)?(${QTY})?`);

function qtyToNumber(s) {
  s = s.trim();
  let total = 0;
  const mixed = s.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(?:and\\s+)?(\\d+\\s*\\/\\s*\\d+|[${UNI_CHARS}])?$`));
  if (mixed) {
    total = parseFloat(mixed[1]);
    s = mixed[2] || '';
  }
  if (UNI_FRAC[s]) total += UNI_FRAC[s];
  else if (/\//.test(s)) {
    const [n, d] = s.split('/').map((x) => parseFloat(x));
    if (d) total += n / d;
  } else if (s && !mixed) total = parseFloat(s);
  return total;
}

function formatQty(v) {
  const whole = Math.floor(v + 1e-6);
  const frac = v - whole;
  if (frac < 0.03 || 1 - frac < 0.03) return String(Math.round(v));
  let best = null;
  for (const [f, ch] of NICE_FRACS) {
    const err = Math.abs(frac - f);
    if (!best || err < best[0]) best = [err, ch];
  }
  if (best && best[0] < 0.03) return (whole ? whole : '') + best[1];
  return String(Math.round(v * 100) / 100);
}

// Scale the leading quantity of one ingredient line ("2 lb chicken" ×2 → "4 lb chicken").
// Lines without a leading quantity ("Salt and pepper") pass through unchanged.
export function scaleIngredient(txt, mult) {
  if (mult === 1) return txt;
  const labeled = txt.match(/^([A-Za-z][A-Za-z ]{0,20}:\s*)(.*)$/);
  if (labeled) return labeled[1] + scaleIngredient(labeled[2], mult);
  const m = txt.match(LEADING_QTY);
  if (!m || !m[1]) return txt;
  let out = formatQty(qtyToNumber(m[1]) * mult);
  if (m[3]) out += m[2] + formatQty(qtyToNumber(m[3]) * mult);
  return out + txt.slice(m[0].length);
}

// ---- grocery list ----

/** The aisles, in the order you walk them. Mirrored in worker/src/util.js. */
export const GROCERY_SECTIONS = [
  { key: 'produce', label: 'Produce' },
  { key: 'meat', label: 'Meat & seafood' },
  { key: 'dairy', label: 'Dairy & eggs' },
  { key: 'bakery', label: 'Bakery' },
  { key: 'frozen', label: 'Freezer' },
  { key: 'pantry', label: 'Pantry' },
  { key: 'drinks', label: 'Drinks' },
  { key: 'household', label: 'Household' },
  { key: 'other', label: 'Other' },
];

// First match wins, so the exceptions sit above the general rules — "chicken
// broth" is a pantry shelf, not the meat counter, and "dried dill" is a spice
// jar rather than a bunch of herbs. Like pantrySkip this is deliberately loose:
// a mis-filed line costs you a few steps in the shop, and anything it doesn't
// recognise lands in "Other" rather than somewhere confidently wrong.
const AISLE_RULES = [
  ['frozen', /\bfrozen\b|\bice creams?\b|\bpopsicles?\b|\bice\b/],
  ['bakery', /\bbreads?\b|\bbaguettes?\b|\bbuns?\b|\brolls?\b|\btortillas?\b|\bpitas?\b|\bnaan\b|\bbagels?\b|\bcroissants?\b|\benglish muffins?\b|\bpie crusts?\b/],
  ['pantry', /\b(?:broth|stock|bouillon)\b|\b(?:peanut|almond) butter\b|\bcoconut (?:milk|cream)\b|\b(?:evaporated|condensed|powdered) milk\b|\bcream of (?:tartar|\w+ soup)\b|\begg noodles\b|\bcans?\b|\bcanned\b|\bjarred\b|\bdried\b|\bground (?:ginger|cinnamon|nutmeg|cloves?|mustard|coriander|allspice|pepper)\b|\btomato (?:paste|sauce|puree)\b|\b(?:black|white) pepper\b|\bpeppercorns?\b|\bred pepper flakes\b|\bsalt and pepper\b|\bcorn(?:starch|meal|\s+syrup)\b|\bchocolates?\b|\bcocoa\b/],
  ['dairy', /\bmilk\b|\bbuttermilk\b|\bcreams?\b|\bhalf.and.half\b|\bbutter\b|\bmargarine\b|\bcheeses?\b|\bcheddar\b|\bmozzarella\b|\bparmesan\b|\bpecorino\b|\bfeta\b|\bricotta\b|\bgouda\b|\bbrie\b|\bswiss\b|\bmonterey jack\b|\byogh?urts?\b|\beggs?\b|\bghee\b/],
  ['meat', /\bchickens?\b|\bbeef\b|\bsteaks?\b|\bpork\b|\bbacon\b|\bsausages?\b|\bturkey\b|\blamb\b|\bveal\b|\bham\b|\bprosciutto\b|\bpepperoni\b|\bchorizo\b|\bribs?\b|\bbrisket\b|\bsalmon\b|\bshrimps?\b|\bprawns?\b|\bfish\b|\btunas?\b|\bcod\b|\btilapia\b|\bhalibut\b|\bscallops?\b|\bcrab\b|\blobster\b|\bmussels\b|\bclams\b|\btofu\b/],
  ['produce', /\bonions?\b|\bscallions?\b|\bshallots?\b|\bgarlic\b|\bgingers?\b|\btomato(?:es)?\b|\bpotato(?:es)?\b|\bsweet potato(?:es)?\b|\bcarrots?\b|\bcelery\b|\blettuce\b|\bromaine\b|\bspinach\b|\bkale\b|\barugula\b|\bgreens\b|\bcabbage\b|\bbroccoli\b|\bcauliflower\b|\bzucchini\b|\bsquash\b|\bcucumbers?\b|\bbell peppers?\b|\b(?:red|green|yellow|orange|poblano|banana|chil[il]) peppers?\b|\bpeppers\b|\bjalape[nñ]os?\b|\bmushrooms?\b|\bgreen beans?\b|\bpeas\b|\bsnap peas\b|\bcorn\b|\basparagus\b|\bavocados?\b|\blemons?\b|\blimes?\b|\boranges?\b|\bapples?\b|\bbananas?\b|\bberries\b|\bgrapes\b|\bmelon\b|\bpineapple\b|\bmango(?:es)?\b|\bpears?\b|\bpeach(?:es)?\b|\bherbs?\b|\bbasil\b|\bparsley\b|\bcilantro\b|\bdill\b|\bmint\b|\bthyme\b|\brosemary\b|\bsage\b|\bchives\b|\bleeks?\b|\bradish(?:es)?\b|\bbeets?\b|\bbrussels sprouts\b|\bsalad\b|\bsprouts?\b/],
  ['drinks', /\bwines?\b|\bbeers?\b|\bsodas?\b|\bjuices?\b|\bcoffee\b|\bteas?\b|\bseltzer\b|\bsparkling water\b/],
  ['household', /\bfoil\b|\bparchment\b|\bplastic wrap\b|\bpaper towels?\b|\bnapkins?\b|\btoothpicks?\b|\bskewers?\b|\btrash bags?\b|\bstorage bags?\b|\bziplocs?\b|\bdish soap\b|\bsponges?\b|\bbatteries\b/],
  ['pantry', /\bflour\b|\bsugars?\b|\brice\b|\bpastas?\b|\bspaghetti\b|\bpenne\b|\bmacaroni\b|\bnoodles?\b|\bbeans?\b|\blentils?\b|\bchickpeas\b|\bquinoa\b|\boils?\b|\bvinegars?\b|\bsalt\b|\bspices?\b|\bcumin\b|\bpaprika\b|\boregano\b|\bcinnamon\b|\bnutmeg\b|\bturmeric\b|\bcurry\b|\bchili powder\b|\bcayenne\b|\bbay leaf|\bsoy sauce\b|\bhot sauce\b|\bworcestershire\b|\bketchup\b|\bmustard\b|\bmayo(?:nnaise)?\b|\bsalsa\b|\bhoney\b|\bsyrups?\b|\bjams?\b|\bjell(?:y|ies)\b|\bbaking (?:powder|soda)\b|\bvanilla\b|\bextracts?\b|\byeast\b|\boats?\b|\bcereals?\b|\bcrackers?\b|\bchips?\b|\bnuts?\b|\balmonds?\b|\bwalnuts?\b|\bpecans?\b|\bcashews?\b|\braisins\b|\bbreadcrumbs\b|\bpanko\b|\bsesame\b|\bcoconut\b|\btahini\b|\bhummus\b|\bmolasses\b|\bshortening\b|\bcooking spray\b|\bcapers\b|\bolives\b|\bpickles?\b|\bsauces?\b|\bpastes?\b/],
];

/** Which aisle a line belongs in. Mirrored in worker/src/util.js. */
export function grocerySection(text) {
  const t = String(text ?? '').toLowerCase();
  for (const [section, re] of AISLE_RULES) if (re.test(t)) return section;
  return 'other';
}

// Measures we'll lift off the front of an ingredient line. Cuts of meat
// ("breasts", "thighs") are deliberately absent: dropping those would merge
// chicken breasts with chicken thighs into one line you can't shop from.
const ING_UNITS = new Set([
  'cup', 'cups', 'c', 'tbsp', 'tablespoon', 'tablespoons', 'tsp', 'teaspoon', 'teaspoons',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds', 'g', 'gram', 'grams', 'kg',
  'ml', 'l', 'liter', 'liters', 'quart', 'quarts', 'pint', 'pints', 'gallon', 'gallons',
  'clove', 'cloves', 'can', 'cans', 'jar', 'jars', 'package', 'packages', 'pkg', 'bag',
  'bags', 'box', 'boxes', 'bunch', 'bunches', 'head', 'heads', 'stick', 'sticks', 'slice',
  'slices', 'sprig', 'sprigs', 'stalk', 'stalks', 'pinch', 'pinches', 'dash', 'handful',
  'loaf', 'loaves', 'bottle', 'bottles', 'container', 'containers', 'piece', 'pieces',
]);

/** "2 cloves garlic, minced" → { amount: '2 cloves', name: 'garlic, minced' } */
export function splitIngredient(line) {
  const whole = String(line ?? '').trim();
  const m = whole.match(LEADING_QTY);
  if (!m || !m[1]) return { amount: '', name: whole };
  let amount = m[0].trim();
  let rest = whole.slice(m[0].length).trim();
  const word = rest.match(/^([A-Za-z]+)\.?\s+(.*)$/);
  if (word && ING_UNITS.has(word[1].toLowerCase())) {
    amount += ` ${word[1]}`;
    rest = word[2].trim();
  }
  rest = rest.replace(/^of\s+/i, '');
  return { amount, name: rest || whole };
}

// Everything a cook writes about *what to do* with an ingredient rather than
// what to buy — dropped so two recipes' wording lands on one line.
const PREP_WORDS =
  /\b(?:fresh|freshly|large|small|medium|ripe|finely|coarsely|roughly|thinly|chopped|minced|diced|sliced|shredded|grated|crushed|drained|rinsed|packed|softened|melted|beaten|divided|optional|halved|quartered|cubed|trimmed|peeled)\b/g;

// Plural → singular, but only where it's safe: "tomatoes" and "cloves" fold,
// "hummus" and "molasses" don't.
const singular = (w) => {
  if (w.length > 4 && /(?:oes|ches|shes|sses)$/.test(w)) return w.replace(/es$/, '');
  if (w.length > 3 && /[^su]s$/.test(w)) return w.slice(0, -1);
  return w;
};

/** What two ingredient lines have to agree on to count as the same shopping item. */
const mergeKey = (name) =>
  name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(',')[0]
    .replace(PREP_WORDS, ' ')
    .replace(/[^a-z ]/g, ' ')
    .trim()
    .split(/\s+/)
    .map(singular)
    .join(' ');

/** The name as it reads on a list: no bracketed asides, no "…, minced". */
const shoppingName = (name) => name.replace(/\([^)]*\)/g, ' ').split(',')[0].replace(/\s+/g, ' ').trim();

const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/**
 * The week's shopping, laid out the way a shop is: by aisle rather than by
 * day, with an ingredient that several meals need collapsed onto one line
 * that remembers which recipes wanted it. Anything the pantry already covers
 * is dropped, and every drop is handed back in `skipped` — a loose name match
 * will occasionally lose something you did need.
 */
export function buildGroceryList({ entries, weekOffset, pantry = [], manual = [] }) {
  const skippedByText = new Map();
  const rows = new Map();

  DAY_NAMES.forEach((dayName, i) => {
    const date = isoDate(addDays(mondayOf(weekOffset), i));
    const entry = entries.find((e) => e.date === date);
    if (!entry) return;
    for (const slot of MEAL_SLOTS) {
      const recipe = entry.meals?.[slot.key]?.recipe;
      if (!recipe) continue;
      for (const text of recipe.ing) {
        const have = pantrySkip(text, pantry);
        if (have) {
          skippedByText.set(text, have.location);
          continue;
        }
        const { amount, name } = splitIngredient(text);
        const key = mergeKey(name) || text.toLowerCase();
        const source = { recipeId: recipe.id, title: recipe.title, dayName, date, meal: slot.label };
        const row = rows.get(key);
        if (row) {
          row.sources.push(source);
          row.amounts.push(amount);
        } else {
          rows.set(key, {
            key: `ing:${key}`,
            text,
            name: shoppingName(name),
            amounts: [amount],
            sources: [source],
            section: grocerySection(text),
          });
        }
      }
    }
  });

  const items = [...rows.values()].map((row) => ({
    key: row.key,
    // One recipe: its own wording, quantity and all. Several: the ingredient
    // itself, with the amounts each recipe asked for beside it.
    label: row.sources.length > 1 ? capitalize(row.name) : row.text,
    amounts: row.sources.length > 1 ? row.amounts.filter(Boolean) : [],
    sources: row.sources,
    section: row.section,
    manualId: null,
  }));

  for (const m of manual) {
    items.push({
      key: `man:${m.id}`,
      label: m.text,
      amounts: [],
      sources: [],
      section: GROCERY_SECTIONS.some((s) => s.key === m.section) ? m.section : 'other',
      manualId: m.id,
    });
  }

  const sections = GROCERY_SECTIONS.map((s) => ({
    ...s,
    items: items.filter((it) => it.section === s.key),
  })).filter((s) => s.items.length);

  return {
    sections,
    total: items.length,
    skipped: [...skippedByText].map(([text, location]) => ({ text, location })),
  };
}

// Tags people created themselves, beyond the built-in meal/tag chips
export function customTagsFrom(recipes) {
  const standard = new Set([...MEALS, ...TAGS]);
  const found = new Set();
  for (const r of recipes) for (const t of r.tags) if (!standard.has(t)) found.add(t);
  return [...found].sort((a, b) => a.localeCompare(b));
}

export function matchesFilters(r, { selMeals, selTags, query, rating = 0 }) {
  const q = query.trim().toLowerCase();
  const matchQ = !q || r.title.toLowerCase().includes(q) || r.tags.some((t) => t.toLowerCase().includes(q));
  const stars = r.rating || 0;
  // rating: 0 = any, 'unrated' = not yet rated, 3/4/5 = that many stars or more
  const matchRating = rating === 0 || (rating === 'unrated' ? stars === 0 : stars >= rating);
  return (
    (selMeals.length === 0 || selMeals.some((m) => r.tags.includes(m))) &&
    (selTags.length === 0 || selTags.some((t) => r.tags.includes(t))) &&
    matchRating &&
    matchQ
  );
}

export const RATING_FILTERS = [
  { value: 5, label: '5 stars' },
  { value: 4, label: '4+ stars' },
  { value: 3, label: '3+ stars' },
  { value: 'unrated', label: 'Unrated' },
];

export const ratingFilterLabel = (v) => RATING_FILTERS.find((o) => o.value === v)?.label || null;

// Sort cycles newest → A–Z → top rated
export const SORTS = ['newest', 'alpha', 'rating'];
export const SORT_LABELS = { newest: 'Newest', alpha: 'A–Z', rating: 'Top rated' };
export const nextSort = (s) => SORTS[(SORTS.indexOf(s) + 1) % SORTS.length];

export function sortRecipes(list, sort) {
  if (sort === 'alpha') return [...list].sort((a, b) => a.title.localeCompare(b.title));
  // Unrated recipes sink to the bottom; ties break alphabetically
  if (sort === 'rating') {
    return [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0) || a.title.localeCompare(b.title));
  }
  return list;
}
