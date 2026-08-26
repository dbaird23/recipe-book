-- Pinch schema (D1)

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  google_sub TEXT UNIQUE,
  avatar_key TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  invited_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token TEXT PRIMARY KEY,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone TEXT,
  used_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  used_at TEXT
);

-- Mutual friendship, stored once with user_a < user_b
CREATE TABLE IF NOT EXISTS friendships (
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS recipes (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  prep INTEGER NOT NULL DEFAULT 0,
  cook INTEGER NOT NULL DEFAULT 0,
  servings INTEGER NOT NULL DEFAULT 1,
  tags TEXT NOT NULL DEFAULT '[]',
  ing TEXT NOT NULL DEFAULT '[]',
  dir TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT,
  from_name TEXT,
  nut TEXT NOT NULL DEFAULT '{"cal":0,"pro":0,"carb":0,"fat":0}',
  nut_edited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- `key` is an R2 object key for uploads, or an absolute URL for imported photos
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  recipe_id TEXT NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  photo_key TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recipes_owner ON recipes(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_photos_recipe ON photos(recipe_id, position);
CREATE INDEX IF NOT EXISTS idx_comments_recipe ON comments(recipe_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(user_b);
