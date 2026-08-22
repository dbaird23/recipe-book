import { uid, nowIso, pairKey, HttpError } from './util.js';

const SESSION_DAYS = 90;
const JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// ---------- Google ID token verification (Web Crypto, no Node deps) ----------

let jwksCache = { keys: null, expires: 0 };

async function getJwks() {
  if (jwksCache.keys && Date.now() < jwksCache.expires) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new HttpError(502, 'Could not reach Google to verify sign-in');
  const { keys } = await res.json();
  // Respect Google's cache header; fall back to an hour
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  jwksCache = { keys, expires: Date.now() + (maxAge ? +maxAge[1] : 3600) * 1000 };
  return keys;
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

export async function verifyGoogleCredential(credential, clientId) {
  if (!clientId) throw new HttpError(500, 'Google sign-in is not configured');
  const parts = String(credential || '').split('.');
  if (parts.length !== 3) throw new HttpError(401, 'Malformed sign-in token');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = b64urlToJson(headerB64);
  if (header.alg !== 'RS256') throw new HttpError(401, 'Unsupported token algorithm');

  const jwk = (await getJwks()).find((k) => k.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'Unknown signing key. Try signing in again');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!ok) throw new HttpError(401, 'Sign-in token failed verification');

  const p = b64urlToJson(payloadB64);
  const now = Math.floor(Date.now() / 1000);
  if (!GOOGLE_ISSUERS.includes(p.iss)) throw new HttpError(401, 'Unexpected token issuer');
  if (p.aud !== clientId) throw new HttpError(401, 'Token was issued for another app');
  if (typeof p.exp !== 'number' || p.exp < now) throw new HttpError(401, 'Sign-in expired. Try again');
  if (!p.email) throw new HttpError(401, 'Google did not share an email address');
  if (p.email_verified === false) throw new HttpError(403, 'Verify your Google email address first');

  return {
    sub: p.sub,
    email: String(p.email).toLowerCase(),
    name: p.name || String(p.email).split('@')[0],
  };
}

// ---------- accounts & sessions ----------

/**
 * Find or create the account for a verified identity.
 * First user ever becomes admin; everyone else needs an unused invite token.
 * New members become friends with every existing member (it's one shared book).
 */
export async function findOrCreateUser(db, { sub, email, name, inviteToken }) {
  const existing = sub
    ? await db.prepare('SELECT * FROM users WHERE google_sub=? OR email=?').bind(sub, email).first()
    : await db.prepare('SELECT * FROM users WHERE email=?').bind(email).first();
  if (existing) {
    if (sub && !existing.google_sub) {
      await db.prepare('UPDATE users SET google_sub=? WHERE id=?').bind(sub, existing.id).run();
    }
    return existing;
  }

  const { n } = await db.prepare('SELECT COUNT(*) AS n FROM users').first();
  let invite = null;
  if (n > 0) {
    invite = inviteToken
      ? await db.prepare('SELECT * FROM invites WHERE token=? AND used_by IS NULL').bind(inviteToken).first()
      : null;
    if (!invite) throw new HttpError(403, 'Recipe Book is invite only. Ask for an invite link to join.');
  }

  const id = uid();
  const now = nowIso();
  const stmts = [
    db
      .prepare('INSERT INTO users (id,email,name,google_sub,is_admin,invited_by,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, email, name, sub || null, n === 0 ? 1 : 0, invite ? invite.created_by : null, now),
  ];
  if (invite) {
    stmts.push(db.prepare('UPDATE invites SET used_by=?, used_at=? WHERE token=?').bind(id, now, invite.token));
    const { results: members } = await db.prepare('SELECT id FROM users').all();
    for (const m of members) {
      const [a, b] = pairKey(id, m.id);
      stmts.push(
        db.prepare('INSERT OR IGNORE INTO friendships (user_a,user_b,created_at) VALUES (?,?,?)').bind(a, b, now)
      );
    }
  }
  await db.batch(stmts);
  return db.prepare('SELECT * FROM users WHERE id=?').bind(id).first();
}

export async function createSession(db, userId) {
  const token = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  await db.prepare('INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,?)').bind(token, userId, expires).run();
  return token;
}

export function sessionCookie(token, secure) {
  const maxAge = SESSION_DAYS * 86400;
  return `session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function clearCookie(secure) {
  return `session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export async function currentUser(request, db) {
  const token = readCookie(request, 'session');
  if (!token) return null;
  return db
    .prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > ?')
    .bind(token, nowIso())
    .first();
}
