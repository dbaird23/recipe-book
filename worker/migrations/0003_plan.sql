-- Weekly dinner plan. One row per user per calendar day.
-- `type` NULL means the day carries only a note, no dinner.
-- recipe_id goes NULL if the referenced recipe is deleted; the reader then
-- reports the day as unavailable rather than dropping the plan silently.
CREATE TABLE IF NOT EXISTS plan_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT,
  recipe_id TEXT REFERENCES recipes(id) ON DELETE SET NULL,
  text TEXT,
  note TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_plan_user_date ON plan_entries(user_id, date);
