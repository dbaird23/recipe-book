-- What's already in the kitchen, so the grocery list can skip it.
--
-- One row per item per location. `qty` is a plain count in whatever `unit`
-- the member typed ("2 cans", "1 bottle", or just "3" with no unit at all),
-- deliberately not normalised, because a pantry is a memory aid, not stock
-- control. An item you run out of is deleted rather than set to zero.
CREATE TABLE IF NOT EXISTS pantry_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  location TEXT NOT NULL, -- 'pantry' | 'fridge' | 'freezer'
  name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1,
  unit TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pantry_user ON pantry_items(user_id, created_at);

-- The same thing twice in one place is a mistake, not two items
CREATE UNIQUE INDEX IF NOT EXISTS idx_pantry_unique
  ON pantry_items(user_id, location, name COLLATE NOCASE);
