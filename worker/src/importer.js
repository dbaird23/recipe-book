// Import a recipe from a URL by reading its schema.org/Recipe JSON-LD,
// which nearly every recipe site publishes for search engines.
import { HttpError, servingsOf } from './util.js';

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

function imageEntries(v) {
  if (v == null) return [];
  if (typeof v === 'string') return [{ url: v, w: 0 }];
  if (Array.isArray(v)) return v.flatMap(imageEntries);
  if (typeof v === 'object') {
    const url = typeof v.url === 'string' ? v.url : typeof v.contentUrl === 'string' ? v.contentUrl : null;
    if (url) return [{ url, w: +v.width || 0 }];
  }
  return [];
}

// Recipe sites publish the SAME picture at several crops — photo.jpg,
// photo-500x500.jpg, photo-480x270.jpg — so a naive read imports one image
// five times. Collapse variants to their base and keep the largest of each.
function imageKey(url) {
  try {
    const u = new URL(url);
    return (u.origin + u.pathname)
      .replace(/[-_]\d{2,4}x\d{2,4}(?=\.\w{3,4}$)/i, '')
      .replace(/[-_]scaled(?=\.\w{3,4}$)/i, '')
      .replace(/[-_@]\dx(?=\.\w{3,4}$)/i, '')
      .toLowerCase();
  } catch {
    return url;
  }
}

// Collapse a run of candidate images to one entry per picture, keeping the
// largest crop of each and the order they were offered in — the recipe's own
// photos first, then whatever else the page had.
function bestImages(entries, max) {
  const best = new Map();
  for (const e of entries) {
    if (!/^https?:\/\//i.test(e.url)) continue;
    // A crop shows up either as a "-500x750" file name or as a resize in the
    // query ("?fit=225,225"); either way it loses to the untouched original.
    const size = /[-_](\d{2,4})x\d{2,4}(?=\.\w{3,4}$)/i.exec(e.url) || /[?&](?:fit|resize|w|width)=(\d{2,4})/i.exec(e.url);
    const width = e.w || (size ? +size[1] : 99999);
    const key = imageKey(e.url);
    const prev = best.get(key);
    if (!prev || width > prev.width) best.set(key, { url: e.url, width });
  }
  return [...best.values()].map((e) => e.url).slice(0, max);
}

// ---------- reading the page itself ----------
//
// Recipe cards publish their ingredients, steps and nutrition as JSON-LD, but
// two things a cook actually wants live only in the markup: the notes under
// the recipe ("make ahead", "freezing", the substitution that saves the dish)
// and the step photos through the post. Both are read straight out of the HTML
// with the same forgiving spirit as the rest of the importer — when a site
// lays them out in a way we don't recognise, we come back empty rather than
// wrong, and the member can paste or upload the rest.

const attrOf = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag);
  return m ? m[1] : '';
};

/**
 * The inner HTML of the element containing `index`, found by counting opening
 * and closing tags of the same name. Enough for the well-formed blocks recipe
 * plugins emit; a page that doesn't close its tags gets the rest of the
 * document, which the callers then find nothing useful in.
 */
function elementAt(html, index) {
  const start = html.lastIndexOf('<', index);
  const name = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start, start + 40));
  const openEnd = html.indexOf('>', index);
  if (start < 0 || !name || openEnd < 0) return '';
  const tag = name[1];
  const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
  re.lastIndex = openEnd + 1;
  let depth = 1;
  for (let m; (m = re.exec(html)); ) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(openEnd + 1, m.index);
  }
  return html.slice(openEnd + 1);
}

// The wrappers the common recipe-card plugins put their notes in, most
// specific first: Tasty Recipes, WP Recipe Maker, Mediavine Create, Cookbook,
// EasyRecipe, then anything else that calls itself recipe notes.
const NOTE_BLOCKS = [
  /class\s*=\s*["'][^"']*\btasty-recipes-notes-body\b/gi,
  /class\s*=\s*["'][^"']*\bwprm-recipe-notes-container\b/gi,
  /class\s*=\s*["'][^"']*\bmv-create-notes\b/gi,
  /class\s*=\s*["'][^"']*\bcookbook-notes\b/gi,
  /class\s*=\s*["'][^"']*\bERSNotes\b/g,
  // Anything else that calls itself recipe notes, however the theme spells it.
  // Plural on purpose: a lone "…__note" is usually a one-line disclaimer
  // hanging off the card rather than the cook's notes.
  /class\s*=\s*["'][^"']*\b[\w-]*recipe[\w-]*[-_]notes\b/gi,
];

/** One note per list item, or per paragraph when the block isn't a list. */
function splitNotes(inner) {
  const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => m[1]);
  const parts = items.length ? items : inner.split(/<\/p>|<br\s*\/?>|<\/div>|<\/h[1-6]>/i);
  return parts
    // Long enough for the "freezing and reheating" essay some sites write,
    // short enough that a mis-matched block can't paste half a page in
    .map((part) => decodeEntities(part).slice(0, 1500))
    // The heading itself sits inside some of these blocks — it isn't a note
    .filter((t) => t && !/^notes?:?$/i.test(t));
}

function notesFrom(html) {
  for (const re of NOTE_BLOCKS) {
    for (const m of html.matchAll(re)) {
      // "2 Tbsp butter (room temperature)" — a plugin's aside on one
      // ingredient line, not the notes under the recipe
      if (/ingredient/i.test(m[0])) continue;
      const notes = splitNotes(elementAt(html, m.index));
      if (notes.length) return notes.slice(0, 12);
    }
  }
  return [];
}

// Images that are furniture rather than food: the author's headshot, the site
// logo, share buttons, ad creative. Cheaper to name them than to guess.
// A "-PIN2-" file is the tall Pinterest graphic with the title printed across
// it — a picture of the recipe, but not one you want in the gallery.
const NOT_A_PHOTO =
  /avatar|gravatar|logo|headshot|icon|badge|banner|button|sprite|pixel|emoji|spacer|placeholder|author|byline|pinit|social|advert|[-_]pin\d*[-_.]|\bads?[-_]/i;

/**
 * The photos through the post — process shots, the finished plate from another
 * angle — from inside the article, so the sidebar and footer don't come along.
 * Lazy-loading rewrites `src` to a placeholder and keeps the real file in
 * `data-src`, which is read first for that reason.
 */
function pageImages(html) {
  const article = /<article\b[^>]*>([\s\S]*)<\/article>/i.exec(html) || /<main\b[^>]*>([\s\S]*)<\/main>/i.exec(html);
  const region = article ? article[1] : html;
  const out = [];
  for (const [tag] of region.matchAll(/<img\b[^>]*>/gi)) {
    const url = attrOf(tag, 'data-lazy-src') || attrOf(tag, 'data-src') || attrOf(tag, 'src');
    if (!/^https?:\/\//i.test(url)) continue;
    const width = +attrOf(tag, 'width') || 0;
    // A declared width under 400 is a thumbnail, a logo or an icon; an image
    // with no width at all still gets a look, judged on its name alone.
    if (width && width < 400) continue;
    if (NOT_A_PHOTO.test(url) || NOT_A_PHOTO.test(attrOf(tag, 'class')) || NOT_A_PHOTO.test(attrOf(tag, 'alt'))) continue;
    out.push({ url, w: width });
  }
  return out;
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
    // "about 35 meatballs" is a yield, not a serving count — the serving size
    // is what turns it into one
    serv: String(servingsOf([].concat(recipe.recipeYield ?? []).map(textOf), textOf(nutrition.servingSize))),
    ing: (recipe.recipeIngredient || []).map(textOf).filter(Boolean).join('\n'),
    dirs: flattenInstructions(recipe.recipeInstructions).join('\n'),
    // Notes are never in the JSON-LD, so they come off the page itself
    notes: notesFrom(html).join('\n'),
    source: domain,
    author: textOf(recipe.author?.name ?? recipe.author) || null,
    // The recipe's own photos first, then the step shots through the post
    images: bestImages([...imageEntries(recipe.image), ...pageImages(html)], 8),
    nutImport: gramsOf(nutrition.calories)
      ? {
          cal: gramsOf(nutrition.calories),
          pro: gramsOf(nutrition.proteinContent),
          carb: gramsOf(nutrition.carbohydrateContent),
          fat: gramsOf(nutrition.fatContent),
          // "5 meatballs with sauce" — what those numbers are actually per
          serving: textOf(nutrition.servingSize),
        }
      : null,
  };
}
