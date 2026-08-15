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
