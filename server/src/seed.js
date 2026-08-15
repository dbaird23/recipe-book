// Seed demo data from the design prototype: three demo friends (Betsy, Hannah,
// Emily) with their recipes, plus five starter recipes in YOUR book.
// Sign in once first (your account becomes the admin), then run: npm run seed
import crypto from 'node:crypto';
import { db, pairKey } from './db.js';

const me = db.prepare('SELECT * FROM users WHERE is_admin=1 ORDER BY created_at LIMIT 1').get();
if (!me) {
  console.error('No account found yet. Start the app, sign in once, then run `npm run seed`.');
  process.exit(1);
}
if (db.prepare("SELECT 1 FROM users WHERE email='betsy@example.com'").get()) {
  console.log('Demo data already seeded.');
  process.exit(0);
}

const uid = () => crypto.randomUUID();

const insertUser = db.prepare('INSERT INTO users (id,email,name,is_admin) VALUES (?,?,?,0)');
const insertFriend = db.prepare('INSERT OR IGNORE INTO friendships (user_a,user_b) VALUES (?,?)');
const insertRecipe = db.prepare(
  `INSERT INTO recipes (id,owner_id,title,prep,cook,servings,tags,ing,dir,notes,source,from_name,nut,nut_edited)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0)`
);
const insertComment = db.prepare('INSERT INTO comments (id,recipe_id,author_id,text) VALUES (?,?,?,?)');

function addRecipe(ownerId, r) {
  const id = uid();
  insertRecipe.run(
    id, ownerId, r.title, r.prep, r.cook, r.servings,
    JSON.stringify(r.tags), JSON.stringify(r.ing), JSON.stringify(r.dir),
    r.notes || '', r.source || null, r.from || null, JSON.stringify(r.nut)
  );
  return id;
}

const seed = db.transaction(() => {
  const betsy = uid(), hannah = uid(), emily = uid();
  insertUser.run(betsy, 'betsy@example.com', 'Betsy');
  insertUser.run(hannah, 'hannah@example.com', 'Hannah');
  insertUser.run(emily, 'emily@example.com', 'Emily');
  const everyone = [me.id, betsy, hannah, emily];
  for (const a of everyone) for (const b of everyone) if (a < b) insertFriend.run(...pairKey(a, b));

  // --- your starter recipes ---
  const m1 = addRecipe(me.id, {
    title: 'Lemon Garlic Chicken', prep: 15, cook: 25, servings: 4,
    tags: ['Dinner', 'Chicken', 'Quick', 'High protein'],
    ing: ['2 lb chicken thighs, boneless', '1 lemon, juiced and zested', '4 cloves garlic, minced', '2 tbsp olive oil', '1 tsp dried oregano', 'Salt and pepper'],
    dir: ['Whisk lemon juice, zest, garlic, oil and oregano; season chicken.', 'Marinate 10 minutes while a skillet heats over medium-high.', 'Sear chicken 5–6 minutes per side until golden and cooked through.', 'Rest 5 minutes, spoon pan juices over, and serve.'],
    nut: { cal: 380, pro: 34, carb: 6, fat: 24 },
    notes: 'Marinate longer if there’s time — 30 min is even better. Meyer lemons when in season.',
  });
  insertComment.run(uid(), m1, hannah, 'Doubled the garlic. No regrets.');

  const m2 = addRecipe(me.id, {
    title: 'Sunday Beef Chili', prep: 20, cook: 240, servings: 8,
    tags: ['Dinner', 'Beef', 'Crockpot'],
    ing: ['2 lb ground beef (90/10)', '1 onion, diced', '2 cans kidney beans, drained', '1 can crushed tomatoes (28 oz)', '3 tbsp chili powder', '1 tsp cumin', '2 cups beef broth'],
    dir: ['Brown the beef with the onion; drain.', 'Add everything to the crockpot and stir.', 'Cook on low 4 hours (or high 2½).', 'Taste, season, and top as you like.'],
    nut: { cal: 410, pro: 31, carb: 28, fat: 19 },
    notes: 'Use 90/10 beef — leaner gets dry. Freezes great in quart bags.',
  });
  insertComment.run(uid(), m2, betsy, 'Made it for the game — added a chipotle pepper!');

  addRecipe(me.id, {
    title: 'Overnight Oats', prep: 5, cook: 0, servings: 1,
    tags: ['Breakfast', 'Quick', 'Low calorie'],
    ing: ['½ cup rolled oats (Quaker Old Fashioned)', '½ cup milk', '¼ cup Greek yogurt (Fage 2%)', '1 tsp chia seeds', '1 tsp honey', 'Berries to top'],
    dir: ['Stir everything but the berries in a jar.', 'Refrigerate overnight.', 'Top with berries in the morning.'],
    nut: { cal: 310, pro: 18, carb: 46, fat: 7 },
  });
  addRecipe(me.id, {
    title: 'Veggie Enchiladas', prep: 25, cook: 30, servings: 6,
    tags: ['Dinner', 'Vegetarian'], from: 'Betsy',
    ing: ['8 corn tortillas', '1 can black beans, drained', '1 zucchini, diced', '1 cup corn', '2 cups enchilada sauce', '1½ cups shredded cheese'],
    dir: ['Sauté zucchini and corn; stir in beans and ½ cup sauce.', 'Fill tortillas, roll, and lay seam-down in a baking dish.', 'Cover with remaining sauce and cheese.', 'Bake at 375°F for 30 minutes.'],
    nut: { cal: 340, pro: 14, carb: 44, fat: 13 },
  });
  addRecipe(me.id, {
    title: 'Gingerbread Cookies', prep: 30, cook: 10, servings: 24,
    tags: ['Dessert', 'Christmas'],
    ing: ['3 cups flour', '1 tbsp ground ginger', '2 tsp cinnamon', '¾ cup butter, softened', '¾ cup brown sugar', '1 egg', '½ cup molasses'],
    dir: ['Cream butter and sugar; beat in egg and molasses.', 'Whisk dry ingredients and combine; chill dough 1 hour.', 'Roll, cut shapes, and bake at 350°F for 9–10 minutes.'],
    nut: { cal: 140, pro: 2, carb: 22, fat: 5 },
  });

  // --- Betsy ---
  const b1 = addRecipe(betsy, {
    title: 'Veggie Enchiladas', prep: 25, cook: 30, servings: 6,
    tags: ['Dinner', 'Vegetarian'],
    ing: ['8 corn tortillas', '1 can black beans, drained', '1 zucchini, diced', '1 cup corn', '2 cups enchilada sauce', '1½ cups shredded cheese'],
    dir: ['Sauté zucchini and corn; stir in beans and ½ cup sauce.', 'Fill tortillas, roll, and lay seam-down in a baking dish.', 'Cover with remaining sauce and cheese.', 'Bake at 375°F for 30 minutes.'],
    nut: { cal: 340, pro: 14, carb: 44, fat: 13 },
  });
  insertComment.run(uid(), b1, me.id, 'Saved! These were a hit.');
  addRecipe(betsy, {
    title: 'Slow Cooker Pulled Pork', prep: 15, cook: 480, servings: 8,
    tags: ['Dinner', 'Crockpot'],
    ing: ['4 lb pork shoulder', '2 tbsp brown sugar', '1 tbsp smoked paprika', '1 cup BBQ sauce (Sweet Baby Ray’s)', '½ cup apple cider vinegar'],
    dir: ['Rub pork with sugar and spices.', 'Cook on low 8 hours with vinegar.', 'Shred, stir in BBQ sauce, and serve on buns.'],
    nut: { cal: 390, pro: 35, carb: 18, fat: 20 },
  });
  addRecipe(betsy, {
    title: 'Kale Caesar Salad', prep: 15, cook: 0, servings: 4,
    tags: ['Side', 'Vegetarian', 'Low calorie', 'Quick'],
    ing: ['1 bunch lacinato kale, ribboned', '¼ cup grated parmesan', '½ cup Caesar dressing', '1 cup croutons', 'Lemon wedge'],
    dir: ['Massage kale with a pinch of salt for 2 minutes.', 'Toss with dressing, parmesan, and croutons.', 'Finish with lemon.'],
    nut: { cal: 210, pro: 7, carb: 16, fat: 14 },
  });
  addRecipe(betsy, {
    title: 'Peppermint Bark', prep: 20, cook: 5, servings: 16,
    tags: ['Dessert', 'Christmas'],
    ing: ['12 oz dark chocolate', '12 oz white chocolate', '½ tsp peppermint extract', '6 candy canes, crushed'],
    dir: ['Melt dark chocolate; spread on a lined sheet and chill.', 'Melt white chocolate with extract; spread on top.', 'Sprinkle candy canes, chill, and break into pieces.'],
    nut: { cal: 190, pro: 2, carb: 22, fat: 11 },
  });

  // --- Hannah ---
  addRecipe(hannah, {
    title: 'Protein Pancakes', prep: 5, cook: 10, servings: 2,
    tags: ['Breakfast', 'High protein', 'Quick'],
    ing: ['1 cup oats', '1 banana', '2 eggs', '1 scoop vanilla protein powder', '½ tsp baking powder', 'Splash of milk'],
    dir: ['Blend everything until smooth.', 'Cook on a greased griddle 2–3 minutes per side.', 'Serve with fruit or a little syrup.'],
    nut: { cal: 330, pro: 28, carb: 38, fat: 9 },
  });
  addRecipe(hannah, {
    title: 'Chicken Tortilla Soup', prep: 15, cook: 30, servings: 6,
    tags: ['Dinner', 'Chicken'],
    ing: ['1 lb chicken breast', '1 onion, diced', '1 can fire-roasted tomatoes', '4 cups chicken broth', '1 cup corn', '1 tsp cumin', 'Tortilla strips'],
    dir: ['Sauté onion; add everything but the strips.', 'Simmer 25 minutes; shred the chicken.', 'Top bowls with tortilla strips.'],
    nut: { cal: 260, pro: 26, carb: 24, fat: 7 },
  });
  addRecipe(hannah, {
    title: 'Banana Bread', prep: 10, cook: 60, servings: 10,
    tags: ['Dessert'], source: 'sallysbakingaddiction.com',
    ing: ['3 ripe bananas', '⅓ cup melted butter', '¾ cup sugar', '1 egg', '1 tsp vanilla', '1½ cups flour', '1 tsp baking soda'],
    dir: ['Mash bananas with butter; mix in sugar, egg, vanilla.', 'Fold in flour and baking soda.', 'Bake at 350°F for 60 minutes in a loaf pan.'],
    nut: { cal: 230, pro: 3, carb: 38, fat: 8 },
  });

  // --- Emily ---
  addRecipe(emily, {
    title: 'Greek Turkey Bowls', prep: 15, cook: 15, servings: 4,
    tags: ['Lunch', 'Dinner', 'Quick', 'High protein'],
    ing: ['1 lb ground turkey (93/7)', '1 tbsp Greek seasoning', '2 cups cooked rice', '1 cucumber, diced', '1 cup cherry tomatoes', '½ cup tzatziki', '¼ cup feta'],
    dir: ['Brown turkey with the seasoning.', 'Build bowls: rice, turkey, veg.', 'Top with tzatziki and feta.'],
    nut: { cal: 420, pro: 33, carb: 39, fat: 15 },
  });
  addRecipe(emily, {
    title: 'Caprese Pasta', prep: 10, cook: 15, servings: 4,
    tags: ['Vegetarian', 'Dinner'],
    ing: ['12 oz penne', '2 cups cherry tomatoes, halved', '8 oz fresh mozzarella pearls', '¼ cup basil, torn', '3 tbsp olive oil', '1 tbsp balsamic glaze'],
    dir: ['Cook pasta; drain and cool slightly.', 'Toss with tomatoes, mozzarella, basil, and oil.', 'Drizzle balsamic before serving.'],
    nut: { cal: 480, pro: 18, carb: 62, fat: 18 },
  });
  addRecipe(emily, {
    title: 'Apple Crisp', prep: 20, cook: 40, servings: 8,
    tags: ['Dessert'],
    ing: ['6 apples, peeled and sliced', '1 tbsp lemon juice', '¾ cup oats', '½ cup flour', '½ cup brown sugar', '6 tbsp cold butter', '1 tsp cinnamon'],
    dir: ['Toss apples with lemon and half the cinnamon in a dish.', 'Cut butter into oats, flour, sugar, remaining cinnamon.', 'Top apples and bake at 350°F for 40 minutes.'],
    nut: { cal: 270, pro: 3, carb: 44, fat: 10 },
  });
});

seed();
console.log(`Seeded demo friends (Betsy, Hannah, Emily) and starter recipes for ${me.name}.`);
