// Import a recipe from a URL by reading its schema.org/Recipe JSON-LD,
// which nearly every recipe site publishes for search engines.
import { HttpError } from './util.js';

function isoDurationToMinutes(v) {
  if (!v) return 0;
  if (typeof v === 'number') return Math.round(v);
  const m = String(v).match(/P(?:([\d.]+)D)?T?(?:([\d.]+)H)?(?:([\d.]+)M)?/i);
  if (!m) return 0;
  return Math.round((+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0));
}

function decodeEntities(s) {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function textOf(v) {
  if (v == null) return '';
  if (typeof v === 'string') return decodeEntities(v);
  if (Array.isArray(v)) return textOf(v[0]);
  if (typeof v === 'object') return textOf(v.text ?? v.name ?? v['@value'] ?? '');
  return String(v);
}

function flattenInstructions(v, out = []) {
  if (v == null) return out;
  if (typeof v === 'string') {
    for (const s of v.split(/\n+/)) if (s.trim()) out.push(decodeEntities(s));
    return out;
  }
  if (Array.isArray(v)) {
    for (const item of v) flattenInstructions(item, out);
    return out;
  }
  if (typeof v === 'object') {
    if (v['@type'] === 'HowToSection' || v.itemListElement) {
      flattenInstructions(v.itemListElement, out);
      return out;
    }
    const t = textOf(v.text ?? v.name ?? '');
    if (t) out.push(t);
    return out;
  }
  return out;
}

function firstServings(v) {
  const t = textOf(v);
  const m = t.match(/\d+/);
  return m ? +m[0] : 1;
}

function imagesOf(v) {
  if (v == null) return [];
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(imagesOf);
  if (typeof v === 'object') return v.url ? [v.url] : [];
  return [];
}

function gramsOf(v) {
  const m = textOf(v).match(/[\d.]+/);
  return m ? Math.round(+m[0]) : 0;
}

function findRecipeNode(node) {
  if (node == null) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findRecipeNode(n);
      if (found) return found;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  const type = node['@type'];
  const types = Array.isArray(type) ? type : [type];
  if (types.includes('Recipe')) return node;
  if (node['@graph']) return findRecipeNode(node['@graph']);
  return null;
}

export async function importFromUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl);
  } catch {
    throw new HttpError(400, "That doesn't look like a link");
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, 'Only http(s) links are supported');

  let res, html;
  try {
    res = await fetch(url, {
      headers: {
        // Recipe sites commonly block unfamiliar agents, so look like a browser
        'user-agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new HttpError(422, `That page returned ${res.status}`);
    html = await res.text();
  } catch (e) {
    if (e instanceof HttpError) throw e;
    console.error(`import failed for ${url.hostname}:`, e?.message || e);
    throw new HttpError(
      502,
      `Couldn’t read ${url.hostname} — the site blocked us. Try “paste the text” instead.`
    );
  }

  const domain = url.hostname.replace(/^www\./, '');
  let recipe = null;
  const ldBlocks = html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, block] of ldBlocks) {
    try {
      recipe = findRecipeNode(JSON.parse(block.trim()));
    } catch {
      /* malformed JSON-LD block; keep looking */
    }
    if (recipe) break;
  }
  if (!recipe) throw new HttpError(422, `Couldn't find a recipe on ${domain}. Try pasting the text instead.`);

  const nutrition = recipe.nutrition || {};
  const prep = isoDurationToMinutes(recipe.prepTime);
  let cook = isoDurationToMinutes(recipe.cookTime);
  if (!prep && !cook) cook = isoDurationToMinutes(recipe.totalTime);

  return {
    title: textOf(recipe.name) || 'Imported Recipe',
    prep: String(prep || ''),
    cook: String(cook || ''),
    serv: String(firstServings(recipe.recipeYield)),
    ing: (recipe.recipeIngredient || []).map(textOf).filter(Boolean).join('\n'),
    dirs: flattenInstructions(recipe.recipeInstructions).join('\n'),
    notes: '',
    source: domain,
    author: textOf(recipe.author?.name ?? recipe.author) || null,
    images: imagesOf(recipe.image).slice(0, 4),
    nutImport: gramsOf(nutrition.calories)
      ? {
          cal: gramsOf(nutrition.calories),
          pro: gramsOf(nutrition.proteinContent),
          carb: gramsOf(nutrition.carbohydrateContent),
          fat: gramsOf(nutrition.fatContent),
        }
      : null,
  };
}
