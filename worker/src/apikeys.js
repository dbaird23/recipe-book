// API keys: a second way to authenticate, for tools that have no browser and
// so no session cookie: Cursor's AI, the MCP server, a shell script.
//
// A key authenticates as its owner but reaches a deliberately smaller surface
// than a signed-in browser does: routes opt in individually (see `KEY` in
// index.js), so account-level actions stay cookie-only.
import { HttpError, uid, nowIso } from './util.js';

const TOKEN_BYTES = 24;
const PREFIX = 'rb_';
// How stale `last_used_at` has to be before a request bothers rewriting it.
// Every API call would otherwise cost an extra D1 write.
const LAST_USED_RESOLUTION_MS = 5 * 60_000;

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashToken(token) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return hex(new Uint8Array(digest));
}

export const apiKeyPublic = (row) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

export async function listApiKeys(db, userId) {
  const { results } = await db
    .prepare('SELECT * FROM api_keys WHERE user_id=? ORDER BY created_at DESC')
    .bind(userId)
    .all();
  return results.map(apiKeyPublic);
}

/** Mint a key. The returned `token` is the only time the plaintext exists. */
export async function createApiKey(db, userId, name) {
  const clean = String(name || '').trim().slice(0, 60);
  if (!clean) throw new HttpError(400, 'Give the key a name so you know what it’s for');
  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM api_keys WHERE user_id=?').bind(userId).first();
  if (n >= 10) throw new HttpError(409, 'You already have 10 keys. Revoke one first');

  const token = PREFIX + hex(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
  const row = {
    id: uid(),
    user_id: userId,
    name: clean,
    // Enough to recognise a key at a glance, far too little to guess it
    prefix: token.slice(0, PREFIX.length + 6),
    hash: await hashToken(token),
    created_at: nowIso(),
    last_used_at: null,
  };
  await db
    .prepare('INSERT INTO api_keys (id,user_id,name,prefix,hash,created_at) VALUES (?,?,?,?,?,?)')
    .bind(row.id, row.user_id, row.name, row.prefix, row.hash, row.created_at)
    .run();
  return { token, key: apiKeyPublic(row) };
}

export async function revokeApiKey(db, userId, id) {
  const { meta } = await db.prepare('DELETE FROM api_keys WHERE id=? AND user_id=?').bind(id, userId).run();
  if (!meta.changes) throw new HttpError(404, 'No such API key');
}

export function bearerToken(request) {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') || '');
  return match ? match[1] : null;
}

/**
 * Resolve a bearer token to its owner. Returns null for anything that isn't
 * one of our tokens, so a malformed header reads as "not signed in".
 */
export async function userForToken(db, token) {
  if (!token || !token.startsWith(PREFIX)) return null;
  const row = await db
    .prepare('SELECT u.*, k.id AS key_id, k.name AS key_name FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.hash=?')
    .bind(await hashToken(token))
    .first();
  if (!row) return null;
  const { key_id, key_name, ...user } = row;
  return { user, key: { id: key_id, name: key_name } };
}

/** Fire-and-forget "last used" stamp, skipped when it was written recently. */
export function touchApiKey(db, keyId) {
  const now = Date.now();
  return db
    .prepare('UPDATE api_keys SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(new Date(now).toISOString(), keyId, new Date(now - LAST_USED_RESOLUTION_MS).toISOString())
    .run();
}
