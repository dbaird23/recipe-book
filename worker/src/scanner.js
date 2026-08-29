// Read a recipe off a photograph: a cookbook held open, a card in a
// grandmother's hand, a clipping gone soft at the folds, a screenshot of a
// text message. None of those publish JSON-LD, so where the URL importer reads
// markup this asks Claude to read the picture, and both hand back the same
// draft for the review screen to correct.
//
// The rule throughout is the importer's rule: come back empty rather than
// wrong. A number half-hidden in the gutter is worth less than a blank the
// cook will notice and fill in, because a wrong quantity looks exactly like a
// right one once it's saved.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError, servingsOf } from './util.js';

const MAX_PHOTOS = 4;
// The API's own ceiling for an inline image. Phones clear it comfortably once
// the browser has scaled the picture down, and anything still over it here
// arrived some other way.
const MAX_BYTES = 5 * 1024 * 1024;
const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// Every field is required and every optional one is nullable: structured
// outputs won't let a field be merely absent, and "the photo doesn't say" is
// an answer we specifically want back rather than an invention.
const DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legible', 'title', 'prepMinutes', 'cookMinutes', 'yield', 'servingSize', 'ingredients', 'directions', 'notes', 'nutrition'],
  properties: {
    legible: {
      type: 'boolean',
      description:
        'True if these photos show a cookable recipe you could read. False if they show something else entirely, or if the writing is too blurred, too dark or too cut off to transcribe.',
    },
    title: { type: 'string', description: 'The recipe’s name as printed. Empty string if it isn’t shown.' },
    prepMinutes: { type: 'integer', description: 'Prep time in minutes, or 0 if the recipe doesn’t give one.' },
    cookMinutes: { type: 'integer', description: 'Cook or bake time in minutes, or 0 if the recipe doesn’t give one. If only a total time is printed, put it here.' },
    yield: {
      type: 'string',
      description: 'What the recipe says it makes, word for word: "Serves 4", "Makes about 24 cookies". Empty string if it doesn’t say.',
    },
    servingSize: {
      type: 'string',
      description: 'What one serving is, if the recipe says so: "2 pancakes", "1 cup". Empty string otherwise.',
    },
    ingredients: {
      type: 'array',
      items: { type: 'string' },
      description:
        'One ingredient per entry, in order, exactly as written. When the recipe groups them, put the group heading in as its own entry ending in a colon ("For the sauce:").',
    },
    directions: {
      type: 'array',
      items: { type: 'string' },
      description: 'One step per entry, in order, without the printed step numbers.',
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Anything alongside the recipe that a cook would want kept: make-ahead and freezing advice, substitutions, a handwritten remark in the margin. Empty array if there is none.',
    },
    nutrition: {
      description: 'Only if the photo prints nutrition figures. Null otherwise — never estimate them.',
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['calories', 'protein', 'carbs', 'fat'],
          properties: {
            calories: { type: 'integer' },
            protein: { type: 'integer', description: 'Grams of protein per serving, 0 if not printed.' },
            carbs: { type: 'integer', description: 'Grams of carbohydrate per serving, 0 if not printed.' },
            fat: { type: 'integer', description: 'Grams of fat per serving, 0 if not printed.' },
          },
        },
      ],
    },
  },
};

const SYSTEM = `You transcribe recipes from photographs for a family recipe book. The photos may be a cookbook page, a handwritten index card, a magazine clipping, a printout or a screen.

Transcribe. Do not improve, complete or modernise. Specifically:

- Copy quantities exactly as written, fractions and all: "1 1/2 cups", "1/4 tsp". Never convert units and never round.
- Keep the recipe's own wording in the steps. Don't merge two steps or split one.
- If part of the recipe is cut off, obscured or unreadable, leave those entries out rather than guessing what they said. A short recipe is fine; an invented line is not.
- Never supply an ingredient because the steps mention it, and never supply a step because it seems to be missing. Only what is actually printed.
- Ignore anything on the page that isn't part of the recipe: page numbers, headers, adjacent recipes, advertising, the photograph's caption.

When several photos are given, they are pages or sides of ONE recipe, in order. Read them as a single recipe and don't repeat what appears on more than one.`;

/** Base64 in fixed chunks: spreading a whole photo into `fromCharCode` overflows the stack. */
function base64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/**
 * The two money failures that don't arrive as a 402. A spend limit someone set
 * on the account comes back as an ordinary 400, and the usage tier's own
 * monthly cap as a 429 — told apart from real rate limiting by the missing
 * retry-after, since a cap doesn't clear on its own the way a burst does.
 * The 400 has no error type of its own to go on, so its wording is all there is.
 */
function isSpendLimit(e) {
  if (e?.status === 429) return !e.headers?.get?.('retry-after');
  return e?.status === 400 && /spend limit|credit balance/i.test(e?.message || '');
}

const lines = (v) => (Array.isArray(v) ? v : []).map((s) => String(s ?? '').trim()).filter(Boolean);

/**
 * Turn photographs of one recipe into the same draft shape the URL importer
 * returns, so the review screen can't tell where a draft came from.
 */
export async function scanFromPhotos(env, photos) {
  if (!env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Reading a recipe from a photo isn’t switched on for this book yet.');
  }
  if (!photos.length) throw new HttpError(400, 'Take or choose a photo first');
  if (photos.length > MAX_PHOTOS) throw new HttpError(400, `That’s more than ${MAX_PHOTOS} photos — one recipe at a time`);

  const images = [];
  for (const photo of photos) {
    if (!MEDIA_TYPES.includes(photo.type)) throw new HttpError(400, 'Photos only (jpeg, png, webp, gif)');
    if (photo.size > MAX_BYTES) throw new HttpError(413, 'That photo is too large to read — try again from the camera');
    images.push({
      type: 'image',
      source: { type: 'base64', media_type: photo.type, data: base64(await photo.arrayBuffer()) },
    });
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  let response;
  try {
    response = await client.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: SYSTEM,
      // Reading a smudged card is a slow, careful job rather than a hard one,
      // and a cook is waiting on the answer.
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...images,
            {
              type: 'text',
              text:
                images.length > 1
                  ? `These ${images.length} photos are one recipe, in order. Transcribe it.`
                  : 'Transcribe the recipe in this photo.',
            },
          ],
        },
      ],
    });
  } catch (e) {
    // The cook gets one sentence they can act on; the detail goes to the log.
    console.error('recipe scan failed:', e?.status || '', e?.type || '', e?.message || e);
    // Money, before anything else, because it's the failure most likely to be
    // mistaken for a bad photo. An empty balance or a payment problem is a 402
    // carrying billing_error; the two spend limits arrive wearing other codes.
    // None of them are the cook's to fix and none improve by trying again, so
    // they say so instead of sending someone back to re-photograph the page.
    if (e?.type === 'billing_error' || e?.status === 402 || isSpendLimit(e)) {
      throw new HttpError(503, 'Reading photos has run out of credit. Tell whoever runs this book.');
    }
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      throw new HttpError(503, 'Reading a recipe from a photo isn’t set up properly. Tell whoever runs this book.');
    }
    if (e instanceof Anthropic.RateLimitError) {
      throw new HttpError(429, 'Too many photos at once. Give it a minute and try again.');
    }
    throw new HttpError(502, 'Couldn’t read that photo just now. Try again, or paste the text instead.');
  }

  // A refusal, or a cap hit mid-transcription, would leave the JSON short or
  // absent. Either way there's nothing to hand back.
  const block = response.content.find((b) => b.type === 'text');
  let read;
  try {
    read = JSON.parse(block.text);
  } catch {
    console.error('recipe scan returned no draft:', response.stop_reason, response.stop_details?.category || '');
    throw new HttpError(502, 'Couldn’t read that photo just now. Try again, or paste the text instead.');
  }

  const ing = lines(read.ingredients);
  const dirs = lines(read.directions);
  // A photo of a book's cover, or of a page whose recipe didn't survive the
  // read, is worth saying so about rather than opening an empty form.
  if (!read.legible || (!ing.length && !dirs.length)) {
    throw new HttpError(
      422,
      'Couldn’t find a recipe in that. Try again with the page flat, the whole recipe in frame and the light on it.'
    );
  }

  return {
    title: String(read.title || '').trim() || 'Scanned Recipe',
    prep: String(read.prepMinutes || ''),
    cook: String(read.cookMinutes || ''),
    // "Makes about 24 cookies" is a yield, not a serving count; the same
    // reading the URL importer and the paste parser both use turns it into one.
    serv: String(servingsOf(read.yield || '', read.servingSize || '')),
    ing: ing.join('\n'),
    dirs: dirs.join('\n'),
    notes: lines(read.notes).join('\n'),
    // Nobody to credit: whoever wrote the card is the cook's own to name.
    source: null,
    author: null,
    images: [],
    nutImport: read.nutrition?.calories
      ? {
          cal: read.nutrition.calories,
          pro: read.nutrition.protein || 0,
          carb: read.nutrition.carbs || 0,
          fat: read.nutrition.fat || 0,
          ...(read.servingSize ? { serving: String(read.servingSize).slice(0, 60) } : null),
        }
      : null,
  };
}
