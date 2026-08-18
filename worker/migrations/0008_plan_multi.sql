-- A meal can be more than one thing: spaghetti and meatballs is the meatball
-- recipe plus a line that just says "spaghetti". So a meal stops being one row
-- and becomes an ordered list of them.
--
-- SQLite can't drop a primary key in place, so the table is rebuilt. Everything
-- planned up to now was a single item, and keeps position 0.

CREATE TABLE plan_entries_v3 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal TEXT NOT NULL, -- 'breakfast' | 'lunch' | 'dinner'
  position INTEGER NOT NULL DEFAULT 0,
  type TEXT NOT NULL, -- 'recipe' | 'leftovers' | 'text'
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  text TEXT,
  updated_at TEXT NOT NULL
);

INSERT INTO plan_entries_v3 (id, user_id, date, meal, position, type, recipe_id, text, updated_at)
  SELECT lower(hex(randomblob(16))), user_id, date, meal, 0, type, recipe_id, text, updated_at
  FROM plan_entries;

DROP TABLE plan_entries;
ALTER TABLE plan_entries_v3 RENAME TO plan_entries;

CREATE INDEX IF NOT EXISTS idx_plan_user_date ON plan_entries(user_id, date, meal, position);
