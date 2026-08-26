-- OAuth 2.1: how ChatGPT (and any other client that won't carry a static key)
-- signs in as a member.
--
-- Cursor takes an API key in a header, so `api_keys` is enough for it. ChatGPT
-- has nowhere to put one: a custom connector either uses no auth at all or it
-- runs the OAuth dance itself, registering as it goes. So the Worker is also a
-- small authorization server. Clients are public and PKCE-only; there are no
-- client secrets to leak, and nothing here can be used without a member sitting
-- in front of a browser saying yes.

-- A client that registered itself (RFC 7591). ChatGPT does this once, the first
-- time a member adds the connector, and reuses the id from then on.
CREATE TABLE IF NOT EXISTS oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL, -- JSON array; a callback must match one exactly
  uri TEXT,                    -- the client's own home page, shown on the consent screen
  created_at TEXT NOT NULL
);

-- An authorize request that has been checked but not yet answered. The Worker
-- parks it here and sends the browser to /connect, so the consent screen is the
-- app itself (already able to sign someone in) rather than a second login page.
-- Short-lived: it dies with the tab.
CREATE TABLE IF NOT EXISTS oauth_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- An authorization code, hashed like everything else we hand out. Single use:
-- redeeming it deletes the row, so a replayed code is simply unknown.
CREATE TABLE IF NOT EXISTS oauth_codes (
  hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource TEXT,
  scope TEXT,
  expires_at TEXT NOT NULL
);

-- Access and refresh tokens. `grant_id` ties one member's connection to one
-- client together across refreshes, so "disconnect ChatGPT" is a single delete
-- and takes every token that connection ever minted with it.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,          -- 'access' | 'refresh'
  grant_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT,
  resource TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_oauth_tokens_grant ON oauth_tokens(grant_id);
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user ON oauth_tokens(user_id, created_at DESC);
