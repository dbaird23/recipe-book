-- Owner's own star rating, 1–5. 0 means unrated.
ALTER TABLE recipes ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_recipes_rating ON recipes(owner_id, rating DESC);
