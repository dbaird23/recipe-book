// Working without a connection.
//
// Three things live here. `net` is whether we can reach the server, which
// the browser's own idea of "online" only half answers: a phone can be on
// wifi with nothing behind it. The store is the last copy of what the server
// said, kept so the app can open on it with no signal at all. And the queue
// is every write made while away, kept until it can be sent, in the order it
// was made, so a line added and then reworded lands as one line reworded.

// ---------- reachability ----------

const netListeners = new Set();
let online = typeof navigator === 'undefined' || navigator.onLine !== false;

export const net = {
  get online() {
    return online;
  },
  /** Called by the API client: a response of any kind means we're reachable, a failed fetch means we're not. */
  set(v) {
    if (online === !!v) return;
    online = !!v;
    for (const fn of netListeners) fn();
  },
  subscribe(fn) {
    netListeners.add(fn);
    return () => netListeners.delete(fn);
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => net.set(true));
  window.addEventListener('offline', () => net.set(false));
}

// ---------- the store ----------

// localStorage rather than IndexedDB: the whole book is a few hundred
// kilobytes at most, and a synchronous read means the app can open straight
// onto it. Every call is wrapped, since a private window or a full disk
// makes any of them throw, and a cache that can't be read is just no cache.

export function readStore(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeStore(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* no room, or no storage: the next visit loads from the server */
  }
}

export function removeStore(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to remove, then */
  }
}

// ---------- ids handed out while away ----------

// A thing made offline needs an id before the server has given it one, so the
// list can show it and later writes can name it. These are told apart by
// their prefix, and swapped for the server's when the write that made the
// thing is finally sent.
export const tempId = () => `tmp-${crypto.randomUUID()}`;

// ---------- the queue ----------

const QUEUE_KEY = 'rb-queue';
const queueListeners = new Set();
let queue = readStore(QUEUE_KEY, []);
// Temp ids resolved so far this session, applied to anything queued after the
// fact that still names the old one.
let resolved = {};

function saveQueue() {
  writeStore(QUEUE_KEY, queue);
  for (const fn of queueListeners) fn();
}

export const pending = () => queue.length;

export function subscribeQueue(fn) {
  queueListeners.add(fn);
  return () => queueListeners.delete(fn);
}

/** Swap every temp id an entry names (in its path or body) for the real one, where known. */
function remapEntry(entry, map) {
  const keys = Object.keys(map);
  if (!keys.length) return entry;
  let text = JSON.stringify({ path: entry.path, body: entry.body ?? null, form: entry.form ?? null });
  for (const t of keys) text = text.split(t).join(map[t]);
  const { path, body, form } = JSON.parse(text);
  return { ...entry, path, body: body ?? undefined, form: form ?? undefined };
}

/**
 * Keep a write for later. An entry is what the API client needs to send it
 * (`method`, `path`, and `body` as JSON or `form` as fields), a `label` for
 * telling the user if the server refuses it, and, for a write that makes
 * something, `made`: the temp ids handed out and where in the response the
 * real ones will be.
 */
export function enqueue(entry) {
  queue = [...queue, remapEntry({ ...entry, at: Date.now() }, resolved)];
  saveQueue();
}

/**
 * Send a write now if we can, and keep it if we can't. Earlier writes still
 * waiting mean this one waits too, so it lands after them: a rename of a line
 * the server hasn't been told about yet has to follow the write that adds it.
 * Either way the caller gets `local()`, its own idea of what the server would
 * have said, and carries on.
 *
 * A write that reached the server and lost its reply on the way back is sent
 * twice. That's a line on the list twice, at worst, and rare enough to live
 * with rather than the alternative, which is a write that's silently dropped.
 */
export async function attempt(call, entry, local) {
  if (queue.length) {
    enqueue(entry);
    return local();
  }
  try {
    return await call();
  } catch (e) {
    if (!e.offline) throw e;
    enqueue(entry);
    return local();
  }
}

function realIds(from, data) {
  if (from === 'items') return (data?.items || []).map((i) => i.id);
  if (from === 'item') return data?.item ? [data.item.id] : [];
  if (from === 'recipe') return data?.recipe ? [data.recipe.id] : [];
  return [];
}

let flushing = null;

/**
 * Send everything waiting, oldest first, through `send(entry)`. Stops at the
 * first sign we're still unreachable and leaves the rest for next time. A
 * write the server refuses outright is dropped rather than tried forever, and
 * handed back so the user can be told. Only the server gets to refuse: any
 * other failure is ours, and a write is kept through a bug rather than lost
 * to one. Returns how many went, which were refused, and the temp ids that
 * now have real ones.
 */
export function flush(send) {
  // One flush at a time, and one caller to act on it: anyone else asking
  // while it runs waits for it and is told nothing happened on their account
  if (flushing) return flushing.then(() => ({ sent: 0, failed: [], idMap: {} }));
  flushing = (async () => {
    const idMap = {};
    const failed = [];
    let sent = 0;
    while (queue.length) {
      const entry = remapEntry(queue[0], idMap);
      let data;
      try {
        data = await send(entry);
      } catch (e) {
        if (!e.status) break;
        failed.push({ entry, error: e });
        queue = queue.slice(1);
        saveQueue();
        continue;
      }
      sent++;
      if (entry.made) {
        const real = realIds(entry.made.from, data);
        entry.made.ids.forEach((t, i) => {
          if (real[i]) idMap[t] = real[i];
        });
      }
      queue = queue.slice(1);
      saveQueue();
    }
    resolved = { ...resolved, ...idMap };
    return { sent, failed, idMap };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Forget everything waiting: for signing out, when the writes belong to someone who's left. */
export function clearQueue() {
  queue = [];
  resolved = {};
  saveQueue();
}
