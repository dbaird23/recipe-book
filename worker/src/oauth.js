// OAuth 2.1: the way in for clients that can't hold an API key.
//
// Cursor takes a bearer token in a header, so `api_keys` is all it needs.
// ChatGPT can't: a custom connector is offered either no authentication at all
// or OAuth, and it registers itself, runs the redirect and holds the token.
// So the Worker is also a small authorization server.
//
// Deliberately narrow, because it is a family recipe book and not an identity
// provider:
//   - public clients only, PKCE (S256) required, so there is no client secret
//     anywhere to leak
//   - a member has to be signed in, in a browser, and say yes; the consent
//     screen is the app itself, at /connect
//   - tokens are stored as SHA-256, like every other token we hand out, and a
//     token reaches exactly the routes an API key reaches, no more
import { HttpError, uid, nowIso, json, sha256Hex, randomToken } from './util.js';

const ACCESS_PREFIX = 'rbat_';
const REFRESH_PREFIX = 'rbrt_';

// A code is redeemed within seconds; a member may take a couple of minutes to
// sign in and read the consent screen. Access tokens are short because the
// refresh token makes renewing them free.
const CODE_TTL_MS = 5 * 60_000;
const REQUEST_TTL_MS = 20 * 60_000;
const ACCESS_TTL_MS = 60 * 60_000;
const REFRESH_TTL_MS = 90 * 86_400_000;

const LAST_USED_RESOLUTION_MS = 5 * 60_000;

// One scope. The real limit on what a token can do is the route allowlist in
// index.js, which is the same one API keys meet, so inventing finer scopes here
// would promise a distinction the app doesn't actually make.
const SCOPE = 'recipes';

export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-max-age': '86400',
};

const isoIn = (ms) => new Date(Date.now() + ms).toISOString();

// ---------- discovery ----------

/** RFC 9728. What the MCP endpoint is, and who issues tokens for it. */
export const protectedResourceMetadata = (origin) => ({
  resource: `${origin}/mcp`,
  authorization_servers: [origin],
  scopes_supported: [SCOPE],
  bearer_methods_supported: ['header'],
  resource_name: 'Pinch',
  resource_documentation: 'https://github.com/dbaird23/recipe-book#ai--api-access',
});

/** RFC 8414. The endpoints a client needs, and the rules it has to follow. */
export const authorizationServerMetadata = (origin) => ({
  issuer: origin,
  authorization_endpoint: `${origin}/oauth/authorize`,
  token_endpoint: `${origin}/oauth/token`,
  registration_endpoint: `${origin}/oauth/register`,
  revocation_endpoint: `${origin}/oauth/revoke`,
  scopes_supported: [SCOPE],
  response_types_supported: ['code'],
  response_modes_supported: ['query'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  token_endpoint_auth_methods_supported: ['none'],
  revocation_endpoint_auth_methods_supported: ['none'],
  code_challenge_methods_supported: ['S256'],
});

// ---------- dynamic client registration (RFC 7591) ----------

/**
 * A redirect target we're willing to send a member's browser to. https only,
 * except on localhost, where a client running on the machine has no https to
 * offer. No fragment, since the authorization response goes in the query.
 */
function validRedirectUri(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash) return false;
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  return url.protocol === 'https:' || (url.protocol === 'http:' && local);
}

export async function registerClient(db, body) {
  const uris = Array.isArray(body?.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length) throw new OAuthError('invalid_redirect_uri', 'Send at least one redirect_uri');
  if (uris.length > 10) throw new OAuthError('invalid_redirect_uri', 'That is too many redirect URIs');
  const bad = uris.find((u) => !validRedirectUri(u));
  if (bad) throw new OAuthError('invalid_redirect_uri', `Not a usable redirect URI: ${bad}`);

  const method = body?.token_endpoint_auth_method;
  if (method && method !== 'none') {
    // We issue no secrets, so a client planning to authenticate with one is
    // going to be disappointed later; say so now.
    throw new OAuthError('invalid_client_metadata', 'Only public clients are supported (token_endpoint_auth_method "none")');
  }

  const name = String(body?.client_name || '').trim().slice(0, 80) || 'An AI assistant';
  const uri = body?.client_uri && validRedirectUri(body.client_uri) ? String(body.client_uri) : null;
  const serialized = JSON.stringify(uris);

  // Registration is open by definition, so the same client re-registering
  // shouldn't grow the table without bound. Identical metadata is the same
  // client: reuse the id rather than minting another.
  const existing = await db
    .prepare('SELECT * FROM oauth_clients WHERE name=? AND redirect_uris=?')
    .bind(name, serialized)
    .first();
  if (existing) return clientRegistration(existing);

  // Sweep up registrations that never went anywhere, so an abandoned or
  // hostile client can't leave rows behind for ever.
  await db
    .prepare(
      `DELETE FROM oauth_clients WHERE created_at < ?
       AND id NOT IN (SELECT DISTINCT client_id FROM oauth_tokens)`
    )
    .bind(isoIn(-30 * 86_400_000))
    .run();

  const row = { id: uid(), name, redirect_uris: serialized, uri, created_at: nowIso() };
  await db
    .prepare('INSERT INTO oauth_clients (id,name,redirect_uris,uri,created_at) VALUES (?,?,?,?,?)')
    .bind(row.id, row.name, row.redirect_uris, row.uri, row.created_at)
    .run();
  return clientRegistration(row);
}

const clientRegistration = (row) => ({
  client_id: row.id,
  client_id_issued_at: Math.floor(Date.parse(row.created_at) / 1000),
  client_name: row.name,
  client_uri: row.uri || undefined,
  redirect_uris: JSON.parse(row.redirect_uris),
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: SCOPE,
});

// ---------- errors ----------

/**
 * An OAuth-shaped failure: `{ error, error_description }`, which is what both
 * the token endpoint and a redirect back to the client have to speak.
 */
export class OAuthError extends Error {
  constructor(code, description, status = 400) {
    super(description);
    this.code = code;
    this.status = status;
  }
}

const STATUS_FOR = { invalid_client: 401, invalid_token: 401, server_error: 500 };

export const oauthErrorResponse = (err) =>
  json(
    { error: err.code || 'server_error', error_description: err.message },
    { status: err.status || STATUS_FOR[err.code] || 400, headers: { ...CORS, 'cache-control': 'no-store' } }
  );

// ---------- authorize ----------

/**
 * Check an /oauth/authorize request and park it.
 *
 * Two kinds of failure, and the difference matters: if we don't trust the
 * client or the redirect_uri we must not bounce the browser anywhere, so those
 * throw and get rendered here. Anything else is the client's mistake and is
 * reported back to it as a redirect, which is what lets ChatGPT show a real
 * message instead of a blank tab.
 */
export async function beginAuthorization(db, url) {
  const q = url.searchParams;
  const clientId = q.get('client_id') || '';
  const redirectUri = q.get('redirect_uri') || '';

  const client = clientId
    ? await db.prepare('SELECT * FROM oauth_clients WHERE id=?').bind(clientId).first()
    : null;
  if (!client) throw new HttpError(400, 'That app isn’t registered with Pinch. Try adding the connector again.');

  const registered = JSON.parse(client.redirect_uris);
  if (!redirectUri || !registered.includes(redirectUri)) {
    throw new HttpError(400, 'That app asked to be sent back to an address it never registered, so the request was stopped.');
  }

  const state = q.get('state');
  const back = (code, description) => {
    const to = new URL(redirectUri);
    to.searchParams.set('error', code);
    to.searchParams.set('error_description', description);
    if (state) to.searchParams.set('state', state);
    return { redirectTo: to.toString() };
  };

  if (q.get('response_type') !== 'code') return back('unsupported_response_type', 'Only the authorization code flow is supported');

  const challenge = q.get('code_challenge');
  if (!challenge) return back('invalid_request', 'PKCE is required: send a code_challenge');
  if ((q.get('code_challenge_method') || 'plain') !== 'S256') {
    return back('invalid_request', 'Only the S256 code challenge method is supported');
  }

  // RFC 8707: the client names the API it wants the token for. We have exactly
  // one, so anything else is a request we can't honour.
  const resource = q.get('resource');
  if (resource) {
    let target;
    try {
      target = new URL(resource);
    } catch {
      return back('invalid_target', 'resource must be a URL');
    }
    if (target.origin !== url.origin) return back('invalid_target', 'This server only issues tokens for its own API');
  }

  const id = uid();
  await db
    .prepare(
      `INSERT INTO oauth_requests (id,client_id,redirect_uri,state,code_challenge,resource,scope,created_at,expires_at)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(id, client.id, redirectUri, state, challenge, resource, SCOPE, nowIso(), isoIn(REQUEST_TTL_MS))
    .run();

  // Hand over to the app: it already knows how to sign someone in, so the
  // consent screen doesn't need a second copy of Google sign-in.
  return { consentPath: `/connect?rq=${encodeURIComponent(id)}` };
}

/** What the consent screen shows: who is asking, and to reach whose book. */
export async function pendingRequest(db, requestId) {
  const row = await db
    .prepare(
      `SELECT r.*, c.name AS client_name, c.uri AS client_uri
       FROM oauth_requests r JOIN oauth_clients c ON c.id=r.client_id
       WHERE r.id=? AND r.expires_at > ?`
    )
    .bind(String(requestId || ''), nowIso())
    .first();
  if (!row) throw new HttpError(404, 'That connection request has expired. Start again from the app you’re connecting.');
  return { id: row.id, clientName: row.client_name, clientUri: row.client_uri, scope: row.scope };
}

/**
 * The member answered. Either way the browser goes back to the client; the
 * request is spent and is deleted whichever way it went.
 */
export async function resolveAuthorization(db, requestId, userId, allow) {
  const row = await db
    .prepare('SELECT * FROM oauth_requests WHERE id=? AND expires_at > ?')
    .bind(String(requestId || ''), nowIso())
    .first();
  if (!row) throw new HttpError(404, 'That connection request has expired. Start again from the app you’re connecting.');
  await db.prepare('DELETE FROM oauth_requests WHERE id=?').bind(row.id).run();

  const to = new URL(row.redirect_uri);
  if (row.state) to.searchParams.set('state', row.state);

  if (!allow) {
    to.searchParams.set('error', 'access_denied');
    to.searchParams.set('error_description', 'You said no to this connection');
    return to.toString();
  }

  const code = randomToken(32);
  await db
    .prepare(
      `INSERT INTO oauth_codes (hash,client_id,user_id,redirect_uri,code_challenge,resource,scope,expires_at)
       VALUES (?,?,?,?,?,?,?,?)`
    )
    .bind(await sha256Hex(code), row.client_id, userId, row.redirect_uri, row.code_challenge, row.resource, row.scope, isoIn(CODE_TTL_MS))
    .run();

  to.searchParams.set('code', code);
  return to.toString();
}

// ---------- token ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

async function issueTokens(db, { grantId, clientId, userId, scope, resource }) {
  const access = ACCESS_PREFIX + randomToken(32);
  const refresh = REFRESH_PREFIX + randomToken(32);
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `INSERT INTO oauth_tokens (hash,kind,grant_id,client_id,user_id,scope,resource,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(await sha256Hex(access), 'access', grantId, clientId, userId, scope, resource, now, isoIn(ACCESS_TTL_MS)),
    db
      .prepare(
        `INSERT INTO oauth_tokens (hash,kind,grant_id,client_id,user_id,scope,resource,created_at,expires_at)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(await sha256Hex(refresh), 'refresh', grantId, clientId, userId, scope, resource, now, isoIn(REFRESH_TTL_MS)),
    // Housekeeping: this connection's spent tokens, and anyone's stale rows.
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(now),
    db.prepare('DELETE FROM oauth_requests WHERE expires_at < ?').bind(now),
  ]);
  return {
    access_token: access,
    token_type: 'Bearer',
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refresh,
    scope,
  };
}

async function redeemCode(db, params) {
  const code = params.get('code');
  const verifier = params.get('code_verifier');
  if (!code) throw new OAuthError('invalid_request', 'Send the authorization code');
  if (!verifier) throw new OAuthError('invalid_request', 'Send the code_verifier');

  const hash = await sha256Hex(code);
  const row = await db.prepare('SELECT * FROM oauth_codes WHERE hash=?').bind(hash).first();
  // Single use, and gone the moment it is looked at: a code replayed by anyone
  // who intercepted it finds nothing, and the real client's grant is unharmed
  // because it already exchanged its copy.
  if (row) await db.prepare('DELETE FROM oauth_codes WHERE hash=?').bind(hash).run();
  if (!row) throw new OAuthError('invalid_grant', 'That authorization code has already been used or has expired');
  if (row.expires_at <= nowIso()) throw new OAuthError('invalid_grant', 'That authorization code has expired');

  const clientId = params.get('client_id');
  if (clientId && clientId !== row.client_id) throw new OAuthError('invalid_grant', 'That code was issued to a different app');

  const redirectUri = params.get('redirect_uri');
  if (redirectUri && redirectUri !== row.redirect_uri) {
    throw new OAuthError('invalid_grant', 'redirect_uri does not match the one the code was issued for');
  }

  if ((await challengeFor(verifier)) !== row.code_challenge) {
    throw new OAuthError('invalid_grant', 'The code_verifier does not match the code_challenge');
  }

  return issueTokens(db, {
    grantId: uid(),
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope || SCOPE,
    resource: row.resource,
  });
}

async function redeemRefresh(db, params) {
  const token = params.get('refresh_token');
  if (!token) throw new OAuthError('invalid_request', 'Send the refresh_token');

  const hash = await sha256Hex(token);
  const row = await db.prepare("SELECT * FROM oauth_tokens WHERE hash=? AND kind='refresh'").bind(hash).first();
  if (!row) throw new OAuthError('invalid_grant', 'That refresh token is no longer valid');
  if (row.expires_at <= nowIso()) {
    await db.prepare('DELETE FROM oauth_tokens WHERE hash=?').bind(hash).run();
    throw new OAuthError('invalid_grant', 'That refresh token has expired. Connect the app again.');
  }

  const clientId = params.get('client_id');
  if (clientId && clientId !== row.client_id) throw new OAuthError('invalid_grant', 'That token was issued to a different app');

  // Rotate: the old refresh token dies with this exchange, so a stolen copy is
  // worth one use at most and stops working the moment the real client renews.
  await db.prepare('DELETE FROM oauth_tokens WHERE hash=?').bind(hash).run();

  return issueTokens(db, {
    grantId: row.grant_id,
    clientId: row.client_id,
    userId: row.user_id,
    scope: row.scope || SCOPE,
    resource: row.resource,
  });
}

export async function exchangeToken(db, params) {
  switch (params.get('grant_type')) {
    case 'authorization_code':
      return redeemCode(db, params);
    case 'refresh_token':
      return redeemRefresh(db, params);
    case null:
    case '':
      throw new OAuthError('invalid_request', 'Send a grant_type');
    default:
      throw new OAuthError('unsupported_grant_type', `Unsupported grant_type: ${params.get('grant_type')}`);
  }
}

/** RFC 7009. Told a token is finished with, take it at its word. */
export async function revokeToken(db, token) {
  if (!token) return;
  await db.prepare('DELETE FROM oauth_tokens WHERE hash=?').bind(await sha256Hex(token)).run();
}

// ---------- using an access token ----------

export const isAccessToken = (token) => !!token && token.startsWith(ACCESS_PREFIX);

/**
 * Resolve an access token to its owner, shaped exactly like an API key so the
 * router's "keys can only reach these routes" rule covers both without knowing
 * the difference. `origin` is checked against the audience the token was minted
 * for, so a token issued for one deployment can't be spent against another.
 */
export async function userForAccessToken(db, token, origin) {
  if (!isAccessToken(token)) return null;
  const row = await db
    .prepare(
      `SELECT u.*, t.hash AS token_hash, t.expires_at AS token_expires, t.resource AS token_resource,
              t.grant_id AS grant_id, c.name AS client_name
       FROM oauth_tokens t
       JOIN users u ON u.id=t.user_id
       JOIN oauth_clients c ON c.id=t.client_id
       WHERE t.hash=? AND t.kind='access'`
    )
    .bind(await sha256Hex(token))
    .first();
  if (!row) return null;
  if (row.token_expires <= nowIso()) throw new OAuthError('invalid_token', 'That access token has expired', 401);
  if (row.token_resource && new URL(row.token_resource).origin !== origin) {
    throw new OAuthError('invalid_token', 'That access token was issued for a different server', 401);
  }
  const { token_hash, token_expires, token_resource, grant_id, client_name, ...user } = row;
  return { user, key: { id: grant_id, name: client_name, hash: token_hash, oauth: true } };
}

export function touchAccessToken(db, hash) {
  const now = Date.now();
  return db
    .prepare('UPDATE oauth_tokens SET last_used_at=? WHERE hash=? AND (last_used_at IS NULL OR last_used_at < ?)')
    .bind(new Date(now).toISOString(), hash, new Date(now - LAST_USED_RESOLUTION_MS).toISOString())
    .run();
}

// ---------- connected apps ----------

/** One row per connection, not per token, so refreshing doesn't multiply them. */
export async function listGrants(db, userId) {
  const { results } = await db
    .prepare(
      `SELECT t.grant_id, c.name AS client_name, c.uri AS client_uri,
              MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at
       FROM oauth_tokens t JOIN oauth_clients c ON c.id=t.client_id
       WHERE t.user_id=? GROUP BY t.grant_id ORDER BY connected_at DESC`
    )
    .bind(userId)
    .all();
  return results.map((r) => ({
    id: r.grant_id,
    name: r.client_name,
    uri: r.client_uri,
    connectedAt: r.connected_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function revokeGrant(db, userId, grantId) {
  const { meta } = await db
    .prepare('DELETE FROM oauth_tokens WHERE grant_id=? AND user_id=?')
    .bind(grantId, userId)
    .run();
  if (!meta.changes) throw new HttpError(404, 'No such connected app');
}
