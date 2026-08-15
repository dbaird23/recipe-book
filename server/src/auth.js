import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, pairKey } from './db.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const SESSION_DAYS = 90;

export function devLoginEnabled() {
  return process.env.NODE_ENV !== 'production' || !GOOGLE_CLIENT_ID;
}

export function googleEnabled() {
  return !!GOOGLE_CLIENT_ID;
}

export async function verifyGoogleCredential(credential) {
  if (!googleClient) throw new Error('Google sign-in is not configured');
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  return { sub: p.sub, email: p.email, name: p.name || p.email.split('@')[0], picture: p.picture || null };
}

/**
 * Find or create the account for a verified identity.
 * First user ever becomes admin; everyone else needs an unused invite token.
 * New members become friends with every existing member (it's one shared book).
 */
export function findOrCreateUser({ sub, email, name, picture, inviteToken }) {
  let user = sub
    ? db.prepare('SELECT * FROM users WHERE google_sub=? OR email=?').get(sub, email)
    : db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (user) {
    if (sub && !user.google_sub) {
      db.prepare('UPDATE users SET google_sub=? WHERE id=?').run(sub, user.id);
    }
    return { user, created: false };
  }

  const count = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  let invite = null;
  if (count > 0) {
    invite = inviteToken
      ? db.prepare('SELECT * FROM invites WHERE token=? AND used_by IS NULL').get(inviteToken)
      : null;
    if (!invite) {
      const err = new Error('Recipe Book is invite only. Ask for an invite link to join.');
      err.status = 403;
      throw err;
    }
  }

  const id = crypto.randomUUID();
  const create = db.transaction(() => {
    db.prepare(
      'INSERT INTO users (id,email,name,google_sub,avatar_url,is_admin,invited_by) VALUES (?,?,?,?,?,?,?)'
    ).run(id, email, name, sub || null, picture || null, count === 0 ? 1 : 0, invite ? invite.created_by : null);
    if (invite) {
      db.prepare("UPDATE invites SET used_by=?, used_at=datetime('now') WHERE token=?").run(id, invite.token);
      const members = db.prepare('SELECT id FROM users WHERE id != ?').all(id);
      const ins = db.prepare('INSERT OR IGNORE INTO friendships (user_a,user_b) VALUES (?,?)');
      for (const m of members) ins.run(...pairKey(id, m.id));
    }
  });
  create();
  return { user: db.prepare('SELECT * FROM users WHERE id=?').get(id), created: true };
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare("INSERT INTO sessions (token,user_id,expires_at) VALUES (?,?,datetime('now', ?))").run(
    token,
    userId,
    `+${SESSION_DAYS} days`
  );
  return token;
}

export function setSessionCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

export function requireAuth(req, res, next) {
  const token = req.cookies?.session;
  if (token) {
    const row = db
      .prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')")
      .get(token);
    if (row) {
      req.user = row;
      return next();
    }
  }
  res.status(401).json({ error: 'Not signed in' });
}

export function destroySession(req, res) {
  const token = req.cookies?.session;
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.clearCookie('session');
}
