-- Things added to the grocery list by hand — batteries, a birthday cake, the
-- milk nobody wrote a recipe for.
--
-- The rest of the list is derived: it's built fresh each time from the week's
-- plan minus the pantry, so it isn't stored. These rows are the part the app
-- can't work out for itself, and they stay on the list until they're removed.
-- `section` is the aisle it's filed under, guessed from the text when the
-- member doesn't pick one.
CREATE TABLE IF NOT EXISTS grocery_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  section TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_grocery_user ON grocery_items(user_id, created_at);
