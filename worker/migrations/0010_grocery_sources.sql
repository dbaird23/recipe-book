-- The grocery list used to be two things at once: these rows, which were only
-- the hand-added part, and a list derived from the week's plan that was worked
-- out fresh on every render and never stored. So there was no one list to point
-- at: no way to say "put this week's ingredients on it", and nothing for an
-- assistant or a shortcut to add to but the hand-added half.
--
-- Now these rows are the whole list. Ingredients are pushed onto it from the
-- plan when the planning is done, and a pushed line remembers the recipes that
-- asked for it: a line several meals want can still say which and open one, and
-- pushing again merges into the line rather than doubling it up. Null for a line
-- somebody typed, which is most of them.
ALTER TABLE grocery_items ADD COLUMN sources TEXT;

-- What the line was matched on when it went on: the same key two recipes'
-- wordings are folded together by. Kept so that rewording a line for the shop
-- ("2 lb chicken thighs, boneless" is not how you buy them) doesn't hide it
-- from the next push, which would put the recipe's wording back on beside it.
ALTER TABLE grocery_items ADD COLUMN merge_key TEXT;
