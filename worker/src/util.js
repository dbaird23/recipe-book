export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

export const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Everything we hand out is stored as its SHA-256, never in the clear. */
export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(digest));
}

export const randomToken = (bytes = 24) => hex(crypto.getRandomValues(new Uint8Array(bytes)));

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

/**
 * Nutrition as it's stored: the four numbers, plus what one serving actually
 * is when the source says so: "5 meatballs with sauce" tells you far more
 * than "333 calories" on its own. Blank when nobody has said.
 */
export function cleanNut(n) {
  const serving = String(n?.serving ?? '').trim().slice(0, 60);
  return {
    cal: +n?.cal || 0,
    pro: +n?.pro || 0,
    carb: +n?.carb || 0,
    fat: +n?.fat || 0,
    ...(serving ? { serving } : null),
  };
}

// Same placeholder heuristic as the design prototype; scales with ingredient count.
export function autoNut(ingCount) {
  const n = ingCount;
  return { cal: 160 + n * 38, pro: 4 + n * 4, carb: 10 + n * 5, fat: 4 + n * 3 };
}

/**
 * A recipe is often two shopping lists in a trenchcoat: the meatballs and the
 * sauce they sit in. Rather than a second field nobody would fill in, a
 * section is a line in the ingredients that names the part below it, written
 * the way cookbooks have always written it: "For the meatballs:".
 *
 * A heading is a short line ending in a colon that doesn't lead with a
 * quantity, which leaves real ingredients alone: "2 tbsp soy sauce" leads
 * with a number, and "Sauce: 2 tbsp soy sauce" doesn't end with the colon.
 * Mirrored in web/src/util.js, which lays the sections out on the recipe page.
 */
const ING_HEADING = /^(?![\d\u00bc-\u00be\u2150-\u215e])[^\n]{1,60}:$/;

export const isIngredientHeading = (line) => ING_HEADING.test(String(line ?? '').trim());

/** How many lines are things to buy, rather than headings over them. */
export const countIngredients = (lines) => lines.filter((l) => !isIngredientHeading(l)).length;

export function sanitizeRecipeInput(body) {
  const clean = (v) => String(v ?? '').trim();
  const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
  const nut = body.nut && typeof body.nut === 'object' ? body.nut : null;
  return {
    title: clean(body.title),
    prep: Math.max(0, +body.prep || 0),
    cook: Math.max(0, +body.cook || 0),
    servings: Math.max(1, +body.servings || 1),
    tags: list(body.tags),
    ing: list(body.ing),
    dir: list(body.dir),
    notes: clean(body.notes),
    source: clean(body.source) || null,
    nut: nut ? cleanNut(nut) : null,
  };
}

// ---------- how much a recipe makes ----------

// Words that mean "a portion of the meal" rather than a thing the recipe makes
const SERVING_WORDS = /^(?:serving|serve|portion|people|person|adult|guest|dish)$/i;

const singularish = (w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w);

/** "about 35 meatballs" → { count: 35, unit: 'meatball' }; "4" → { count: 4, unit: '' } */
function countAndUnit(text) {
  // A range is really its lower end, so "6–8 servings" feeds 6
  const t = String(text ?? '').replace(/(\d)\s*(?:-|–|—|\bto\b)\s*\d+/g, '$1');
  const m = /(\d+(?:\.\d+)?)\s*([A-Za-z]+)?/.exec(t);
  if (!m) return { count: 0, unit: '' };
  return { count: parseFloat(m[1]), unit: singularish((m[2] || '').toLowerCase()) };
}

/**
 * How many servings a recipe makes, from what it says it yields.
 *
 * A yield is often a count of things rather than of meals ("about 35
 * meatballs" is not 35 dinners), so when the nutrition says what one serving
 * is in the same units ("5 meatballs with sauce"), the two are divided into
 * each other and this recipe correctly serves seven. Without that second
 * number there's nothing better to go on than the count itself, which is the
 * right answer anyway for the "12 cookies" kind of yield.
 *
 * `recipeYield` may be a list: sites publish the yield twice, once as a bare
 * number and once as the phrase that says what is being counted.
 * Mirrored in web/src/util.js for the paste parser.
 */
export function servingsOf(recipeYield, servingSize) {
  const parts = (Array.isArray(recipeYield) ? recipeYield : [recipeYield])
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .map(countAndUnit)
    .filter((p) => p.count > 0);
  if (!parts.length) return 1;
  const yielded = parts.find((p) => p.unit) || parts[0];
  const whole = (n) => Math.max(1, Math.round(n));
  if (!yielded.unit || SERVING_WORDS.test(yielded.unit)) return whole(yielded.count);

  const per = countAndUnit(servingSize);
  if (per.count > 0 && per.unit === yielded.unit) return whole(yielded.count / per.count);
  return whole(yielded.count);
}

// ---------- meal plan ----------

/** The meals of a planned day, in the order they're eaten. */
export const MEALS = ['breakfast', 'lunch', 'dinner'];

// ---------- pantry ----------

export const PANTRY_LOCATIONS = ['pantry', 'fridge', 'freezer'];

// Words we'll lift out of "2 cans black beans" as the unit. Anything else
// after the number belongs to the name: "3 large onions" is 3 of "large
// onions", not 3 larges.
const PANTRY_UNITS = new Set([
  'can', 'cans', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'box', 'boxes', 'bag', 'bags',
  'package', 'packages', 'pkg', 'jar', 'jars', 'bottle', 'bottles', 'pack', 'packs',
  'dozen', 'head', 'heads', 'stick', 'sticks', 'bunch', 'bunches', 'gallon', 'quart',
  'loaf', 'loaves', 'carton', 'cartons', 'container', 'containers', 'block', 'blocks',
]);

/**
 * Read one typed line into a pantry item: "2 cans black beans" → 2 × "black
 * beans" in cans, "Olive oil" → 1 × "Olive oil". `hadQty` says whether the
 * line led with a number, which is how an edit tells "rename it" from
 * "rename it and recount it".
 */
// Dictation writes small numbers as words and leaves in the "of" nobody types,
// as in "two cans of black beans". Both are straightened out before the line is
// read apart, so a dictated shelf reads the same as a typed one. Mirrored in
// web/src/util.js.
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20,
};

/** "two cans of black beans" → "2 cans black beans". */
export function normalizeSpoken(text) {
  const v = String(text ?? '').trim();
  const lead = v.match(/^([A-Za-z]+)\b\s*/);
  const n = lead && NUMBER_WORDS[lead[1].toLowerCase()];
  const withQty = n ? `${n} ${v.slice(lead[0].length)}` : v;
  // Only after a unit: "1 bag of rice" is a bag of rice, "Bag of Holding" isn't
  return withQty.replace(/^(\d+(?:\.\d+)?\s+[A-Za-z]+)\s+of\s+/i, '$1 ');
}

/**
 * Split a run of items into lines: what dictation hands over is one long
 * sentence: "two cans of black beans, rice and three onions". Splitting on
 * "and" occasionally cuts an item in half ("bread and butter pickles"), which
 * is why every item stays editable and removable afterwards.
 * Mirrored in web/src/util.js.
 */
export const splitSpokenEntries = (text) =>
  String(text ?? '')
    .split(/[\n,]|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

// The count doesn't always come first: plenty of people write the thing they
// have and then how much of it: "spaghetti 2 bags", "eggs 12". Only read as a
// count when the line ends there, so "9x13 pan" and "chili powder" are safe.
const TRAILING_QTY = /^(.*[A-Za-z].*?)\s+(\d+(?:\.\d+)?)\s*([A-Za-z]+)?$/;

export function parsePantryEntry(text) {
  const v = normalizeSpoken(text);
  const m = v.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]+)?\s+(.+)$/);
  if (m) {
    const unit = (m[2] || '').toLowerCase();
    if (m[2] && PANTRY_UNITS.has(unit)) return { name: m[3].trim(), qty: parseFloat(m[1]), unit, hadQty: true };
    return { name: (m[2] ? `${m[2]} ` : '') + m[3].trim(), qty: parseFloat(m[1]), unit: '', hadQty: true };
  }
  const t = v.match(TRAILING_QTY);
  // A word after the trailing number has to be a unit; otherwise it's part of
  // the name ("Route 66 sauce"), and the line is just an item with no count.
  if (t && (!t[3] || PANTRY_UNITS.has(t[3].toLowerCase()))) {
    return { name: t[1].trim(), qty: parseFloat(t[2]), unit: (t[3] || '').toLowerCase(), hadQty: true };
  }
  return { name: v, qty: 1, unit: '', hadQty: false };
}

/**
 * The pantry item that covers an ingredient line, or null. "Kidney beans"
 * covers "2 cans kidney beans, drained". Deliberately loose and blind to a
 * trailing plural: a wrong skip costs one trip down an aisle, and every skip
 * is listed back to you. Names under three characters never match, because too
 * many false hits follow. Mirrored in web/src/util.js for the in-browser grocery list.
 */
export function pantrySkip(text, items) {
  const t = String(text).toLowerCase();
  return items.find((it) => {
    const name = it.name.toLowerCase().replace(/s$/, '');
    return name.length > 2 && t.includes(name);
  }) || null;
}

// ---------- grocery list ----------

/** The aisles, in the order you walk them. Mirrored in web/src/util.js. */
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

// First match wins, so the exceptions sit above the general rules: "chicken
// broth" is a pantry shelf, not the meat counter, and "dried dill" is a spice
// jar rather than a bunch of herbs. Like pantrySkip this is deliberately loose:
// a mis-filed line costs you a few steps in the shop, and anything it doesn't
// recognise lands in "Other" rather than somewhere confidently wrong.
const AISLE_RULES = [
  ['frozen', /\bfrozen\b|\bice creams?\b|\bpopsicles?\b|\bice\b/],
  ['bakery', /\bbreads?\b|\bsourdough\b|\bloaf\b|\bloaves\b|\bciabatta\b|\bfocaccia\b|\bbrioche\b|\bbaguettes?\b|\bbuns?\b|\brolls?\b|\btortillas?\b|\bpitas?\b|\bnaan\b|\bbagels?\b|\bcroissants?\b|\benglish muffins?\b|\bpie crusts?\b/],
  ['pantry', /\b(?:broth|stock|bouillon)\b|\b(?:peanut|almond) butter\b|\bcoconut (?:milk|cream)\b|\b(?:evaporated|condensed|powdered) milk\b|\bcream of (?:tartar|\w+ soup)\b|\begg noodles\b|\bcans?\b|\bcanned\b|\btins?\b|\btinned\b|\bjarred\b|\bdried\b|\bground (?:ginger|cinnamon|nutmeg|cloves?|mustard|coriander|allspice|pepper)\b|\btomato (?:paste|sauce|puree)\b|\b(?:black|white) pepper\b|\bpeppercorns?\b|\bred pepper flakes\b|\bsalt and pepper\b|\bcorn(?:starch|meal|\s+syrup)\b|\bchocolates?\b|\bcocoa\b/],
  ['dairy', /\bmilk\b|\bbuttermilk\b|\bcreams?\b|\bhalf.and.half\b|\bbutter\b|\bmargarine\b|\bcheeses?\b|\bcheddar\b|\bmozzarella\b|\bparmesan\b|\bpecorino\b|\bfeta\b|\bricotta\b|\bgouda\b|\bbrie\b|\bswiss\b|\bmonterey jack\b|\byogh?urts?\b|\beggs?\b|\bghee\b/],
  ['meat', /\bchickens?\b|\bbeef\b|\bsteaks?\b|\bpork\b|\bbacon\b|\bsausages?\b|\bturkey\b|\blamb\b|\bveal\b|\bham\b|\bprosciutto\b|\bpepperoni\b|\bchorizo\b|\bribs?\b|\bbrisket\b|\bsalmon\b|\bshrimps?\b|\bprawns?\b|\bfish\b|\btunas?\b|\bcod\b|\btilapia\b|\bhalibut\b|\bscallops?\b|\bcrab\b|\blobster\b|\bmussels\b|\bclams\b|\btofu\b/],
  ['produce', /\bonions?\b|\bscallions?\b|\bshallots?\b|\bgarlic\b|\bgingers?\b|\btomato(?:es)?\b|\bpotato(?:es)?\b|\bsweet potato(?:es)?\b|\bcarrots?\b|\bcelery\b|\blettuce\b|\bromaine\b|\bspinach\b|\bkale\b|\barugula\b|\bgreens\b|\bcabbage\b|\bbroccoli\b|\bcauliflower\b|\bzucchini\b|\bsquash\b|\bcucumbers?\b|\bbell peppers?\b|\b(?:red|green|yellow|orange|poblano|banana|chil[il]) peppers?\b|\bpeppers\b|\bjalape[nñ]os?\b|\bmushrooms?\b|\bgreen beans?\b|\bpeas\b|\bsnap peas\b|\bcorn\b|\basparagus\b|\bavocados?\b|\blemons?\b|\blimes?\b|\boranges?\b|\bapples?\b|\bbananas?\b|\bberries\b|\bgrapes\b|\bmelon\b|\bpineapple\b|\bmango(?:es)?\b|\bpears?\b|\bpeach(?:es)?\b|\bherbs?\b|\bbasil\b|\bparsley\b|\bcilantro\b|\bdill\b|\bmint\b|\bthyme\b|\brosemary\b|\bsage\b|\bchives\b|\bleeks?\b|\bradish(?:es)?\b|\bbeets?\b|\bbrussels sprouts\b|\bsalad\b|\bsprouts?\b/],
  ['drinks', /\bwines?\b|\bbeers?\b|\bsodas?\b|\bjuices?\b|\bcoffee\b|\bteas?\b|\bseltzer\b|\bsparkling water\b/],
  ['household', /\bfoil\b|\bparchment\b|\bplastic wrap\b|\bpaper towels?\b|\bnapkins?\b|\btoothpicks?\b|\bskewers?\b|\btrash bags?\b|\bstorage bags?\b|\bziplocs?\b|\bdish soap\b|\bsponges?\b|\bbatteries\b/],
  ['pantry', /\bflour\b|\bsugars?\b|\brice\b|\bpastas?\b|\bspaghetti\b|\bpenne\b|\bmacaroni\b|\bnoodles?\b|\bbeans?\b|\blentils?\b|\bchickpeas\b|\bquinoa\b|\boils?\b|\bvinegars?\b|\bsalt\b|\bspices?\b|\bcumin\b|\bpaprika\b|\boregano\b|\bcinnamon\b|\bnutmeg\b|\bturmeric\b|\bcurry\b|\bchili powder\b|\bcayenne\b|\bbay leaf|\bsoy sauce\b|\bhot sauce\b|\bworcestershire\b|\bketchup\b|\bmustard\b|\bmayo(?:nnaise)?\b|\bsalsa\b|\bhoney\b|\bsyrups?\b|\bjams?\b|\bjell(?:y|ies)\b|\bbaking (?:powder|soda)\b|\bvanilla\b|\bextracts?\b|\byeast\b|\boats?\b|\bcereals?\b|\bcrackers?\b|\bchips?\b|\bnuts?\b|\balmonds?\b|\bwalnuts?\b|\bpecans?\b|\bcashews?\b|\braisins\b|\bbreadcrumbs\b|\bpanko\b|\bsesame\b|\bcoconut\b|\btahini\b|\bhummus\b|\bmolasses\b|\bshortening\b|\bcooking spray\b|\bcapers\b|\bolives\b|\bpickles?\b|\bsauces?\b|\bpastes?\b/],
];

/** Which aisle a line belongs in. Mirrored in web/src/util.js. */
export function grocerySection(text) {
  const t = String(text ?? '').toLowerCase();
  for (const [section, re] of AISLE_RULES) if (re.test(t)) return section;
  return 'other';
}

const IMAGE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

/**
 * The image format a run of bytes actually is, read from its first few bytes.
 * An assistant handing us a picture over MCP labels it however it likes, or
 * not at all, and the bytes are the only part of that which can't be wrong.
 * Null when it isn't one of the four formats we take.
 */
export function sniffImageType(bytes) {
  const b = bytes;
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  // "RIFF" .... "WEBP"
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

/** Store an uploaded image in R2 and return its object key. */
export async function putImage(env, file) {
  if (!file || typeof file.arrayBuffer !== 'function') throw new HttpError(400, 'No photo uploaded');
  const ext = IMAGE_EXT[file.type];
  if (!ext) throw new HttpError(400, 'Images only (jpeg, png, webp, gif)');
  if (file.size > 8 * 1024 * 1024) throw new HttpError(413, 'Photos need to be under 8 MB');
  const key = `${uid()}.${ext}`;
  // Buffer first: R2 needs a known length, and streams of unknown length can truncate
  await env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  return key;
}

/** Photo rows store either an R2 key or an absolute URL (imported photos). */
export const photoUrl = (key) => (/^https?:\/\//.test(key) ? key : `/uploads/${key}`);
