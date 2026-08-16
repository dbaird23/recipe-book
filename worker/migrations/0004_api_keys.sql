-- Personal API keys — how an outside tool (Cursor, a script, the MCP server)
-- signs in as a member without a browser session.
--
-- Only the SHA-256 of the token is stored; the plaintext is shown once at
-- creation and is unrecoverable after that. `prefix` is the first few visible
-- characters, kept so a member can tell their keys apart in the list.
-- Revoking a key deletes the row.
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id, created_at DESC);
