export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const uid = () => crypto.randomUUID();
export const nowIso = () => new Date().toISOString();
export const pairKey = (a, b) => (a < b ? [a, b] : [b, a]);

export const json = (data, init = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers || {}) },
  });

// Same placeholder heuristic as the design prototype — scales with ingredient count.
export function autoNut(ingCount) {
  const n = ingCount;
  return { cal: 160 + n * 38, pro: 4 + n * 4, carb: 10 + n * 5, fat: 4 + n * 3 };
}

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
    nut: nut ? { cal: +nut.cal || 0, pro: +nut.pro || 0, carb: +nut.carb || 0, fat: +nut.fat || 0 } : null,
  };
}

// ---------- pantry ----------

export const PANTRY_LOCATIONS = ['pantry', 'fridge', 'freezer'];

// Words we'll lift out of "2 cans black beans" as the unit. Anything else
// after the number belongs to the name — "3 large onions" is 3 of "large
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
 * trailing plural: a wrong skip costs one trip down an aisle, and every skip
 * is listed back to you. Names under three characters never match — too many
 * false hits. Mirrored in web/src/util.js for the in-browser grocery list.
 */
export function pantrySkip(text, items) {
  const t = String(text).toLowerCase();
  return items.find((it) => {
    const name = it.name.toLowerCase().replace(/s$/, '');
    return name.length > 2 && t.includes(name);
  }) || null;
}

const IMAGE_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

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
