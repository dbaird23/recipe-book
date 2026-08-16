-- Breakfast and lunch join dinner: one row per meal per day, rather than one
-- row per day.
--
-- Notes stay a property of the day, not of a meal, so they move into their own
-- table instead of having to pick a meal to live on. A plan row now exists
-- only when something is actually planned, which is why `type` is NOT NULL.

CREATE TABLE IF NOT EXISTS plan_notes (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  note TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

INSERT OR IGNORE INTO plan_notes (user_id, date, note, updated_at)
  SELECT user_id, date, note, updated_at FROM plan_entries WHERE note IS NOT NULL AND note <> '';

-- SQLite can't widen a primary key in place, so the table is rebuilt.
-- Everything planned up to now was dinner.
CREATE TABLE plan_entries_v2 (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  meal TEXT NOT NULL, -- 'breakfast' | 'lunch' | 'dinner'
  type TEXT NOT NULL, -- 'recipe' | 'leftovers' | 'text'
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  text TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, meal)
);

INSERT INTO plan_entries_v2 (user_id, date, meal, type, recipe_id, text, updated_at)
  SELECT user_id, date, 'dinner', type, recipe_id, text, updated_at FROM plan_entries WHERE type IS NOT NULL;

DROP TABLE plan_entries;
ALTER TABLE plan_entries_v2 RENAME TO plan_entries;

CREATE INDEX IF NOT EXISTS idx_plan_user_date ON plan_entries(user_id, date);
CREATE INDEX IF NOT EXISTS idx_plan_notes_user_date ON plan_notes(user_id, date);
