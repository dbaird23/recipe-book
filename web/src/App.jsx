import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { TabBar } from './components.jsx';
import SignIn from './screens/SignIn.jsx';
import Home from './screens/Home.jsx';
import { Friends, FriendDetail } from './screens/Friends.jsx';
import Recipe from './screens/Recipe.jsx';
import { AddStep1, AddStep2 } from './screens/Add.jsx';
import Plan from './screens/Plan.jsx';
import Pantry from './screens/Pantry.jsx';
import Groceries from './screens/Groceries.jsx';
import Connect from './screens/Connect.jsx';
import { ProfileSheet, ApiKeysSheet, FilterSheet, ShareSheet, InviteSheet, RemoveFriendSheet, PlanPickerSheet, PlanRecipeSheet } from './sheets.jsx';
import { matchesFilters, customTagsFrom, nextSort, groupGroceries, splitSpokenEntries, MEAL_SLOTS, mondayOf, addDays, isoDate } from './util.js';

const EMPTY_FILTERS = { selMeals: [], selTags: [], query: '', rating: 0 };

function readStore(key) {
  try {
    return JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    return {};
  }
}

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteToken, setInviteToken] = useState(null);
  // Set when we've landed on /connect: an outside app is asking for access and
  // this tab exists to answer that, not to browse recipes.
  const [connectRq, setConnectRq] = useState(null);

  const [screen, setScreen] = useState('home');
  const [myRecipes, setMyRecipes] = useState([]);
  const [friends, setFriends] = useState([]);
  const [allFriendRecipes, setAllFriendRecipes] = useState([]);
  const [friendRecipes, setFriendRecipes] = useState([]);
  const [currentFriend, setCurrentFriend] = useState(null);
  const [currentRecipe, setCurrentRecipe] = useState(null);
  const [backTo, setBackTo] = useState('home');

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState('newest');
  const [layout, setLayout] = useState(() => localStorage.getItem('rb-layout') || 'list');

  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);

  const [sheet, setSheet] = useState(null); // 'profile' | 'keys' | 'filter' | 'share' | 'invite' | 'remove'

  // meal plan
  const [weekOffset, setWeekOffset] = useState(0);
  const [planEntries, setPlanEntries] = useState([]);
  const [resumedAt, setResumedAt] = useState(0);
  const [picking, setPicking] = useState(null); // { day, slot } while the picker is open
  // Ticks and deletions stay in the browser: they're a scratchpad for one trip
  // round the shop, not something worth a round trip while you're standing in
  // an aisle. Both are filed under the week they belong to, so last week's
  // shop doesn't quietly hide this week's flour.
  const [groceryChecked, setGroceryChecked] = useState(() => readStore('rb-grocery-v4'));
  const [shopping, setShopping] = useState(false);
  // Lines reworded for this week's shop. A recipe's wording belongs to the
  // recipe, so the new words are kept here rather than written back to it.
  // pantry: what's already in the kitchen, so the grocery list can skip it
  const [pantry, setPantry] = useState([]);
  // groceries added by hand, alongside whatever the week's plan calls for
  const [groceryItems, setGroceryItems] = useState([]);

  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const loadAll = useCallback(async () => {
    const [mine, fr, all, kitchen, list] = await Promise.all([
      api.myRecipes(), api.friends(), api.allFriendRecipes(), api.pantry(), api.groceries(),
    ]);
    setMyRecipes(mine.recipes);
    setFriends(fr.friends);
    setAllFriendRecipes(all.recipes);
    setPantry(kitchen.items);
    setGroceryItems(list.items);
    return mine.recipes;
  }, []);

  // A phone doesn't reload the app when you come back to it: on the home
  // screen it's resumed exactly as it was left, so anything that arrived while
  // it was away -- Siri putting something on the list, an assistant, another
  // device -- would go unseen until it was killed and opened again. Coming
  // back to the front is the moment to ask again. Quietly: a refresh that
  // fails is worth no toast when nothing was asked for.
  useEffect(() => {
    if (!user) return;
    const onShow = () => {
      if (document.visibilityState !== 'visible') return;
      loadAll().catch(() => {});
      setResumedAt(Date.now());
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [user, loadAll]);

  // Boot: config, invite path, session, deep link
  useEffect(() => {
    (async () => {
      const cfg = await api.config().catch(() => ({ googleEnabled: false, devLoginEnabled: true, googleClientId: null, scanEnabled: false }));
      setConfig(cfg);

      const inviteMatch = location.pathname.match(/^\/invite\/([a-f0-9]+)$/);
      if (inviteMatch) {
        setInviteToken(inviteMatch[1]);
        setInvite(await api.inviteInfo(inviteMatch[1]).catch((e) => ({ error: e.message })));
      }

      const connecting = location.pathname === '/connect'
        ? new URLSearchParams(location.search).get('rq')
        : null;
      if (connecting) setConnectRq(connecting);

      try {
        const { user: u } = await api.me();
        setUser(u);
        // The consent screen needs nothing but the account, and this tab is
        // about to leave for whoever asked, so don't pull the whole book in.
        if (!connecting) await loadAll();
        const r = new URLSearchParams(location.search).get('r');
        if (r) {
          try {
            const { recipe } = await api.getRecipe(r);
            setCurrentRecipe(recipe);
            setBackTo('home');
            setScreen('recipe');
          } catch {
            /* recipe gone or not visible */
          }
          history.replaceState(null, '', '/');
        }
      } catch {
        /* not signed in */
      }
      setBooted(true);
    })();
  }, [loadAll]);

  async function handleSignedIn(u) {
    setUser(u);
    if (inviteToken) history.replaceState(null, '', '/');
    if (!connectRq) await loadAll();
  }

  async function signOut() {
    await api.logout();
    setUser(null);
    setSheet(null);
    setScreen('home');
    setMyRecipes([]);
    setFriends([]);
    setAllFriendRecipes([]);
    setPantry([]);
    setGroceryItems([]);
  }

  // Keep a mutated recipe in sync across every list that may hold it
  function applyRecipe(recipe) {
    setCurrentRecipe((cur) => (cur && cur.id === recipe.id ? recipe : cur));
    const patch = (list) => list.map((r) => (r.id === recipe.id ? recipe : r));
    setMyRecipes(patch);
    setFriendRecipes(patch);
    setAllFriendRecipes(patch);
  }

  const isMine = currentRecipe && user && currentRecipe.ownerId === user.id;
  const savedAlready = currentRecipe && !isMine && myRecipes.some((m) => m.title === currentRecipe.title);

  // ---- meal plan ----

  const weekStart = isoDate(mondayOf(weekOffset));
  const weekEnd = isoDate(addDays(mondayOf(weekOffset), 6));

  useEffect(() => {
    if (!user || (screen !== 'plan' && screen !== 'groceries')) return;
    let stale = false;
    api
      .plan(weekStart, weekEnd)
      .then(({ entries }) => { if (!stale) setPlanEntries(entries); })
      .catch((e) => toast(e.message));
    return () => { stale = true; };
  }, [user, screen, weekStart, weekEnd, resumedAt]);

  async function savePlanDay(date, body) {
    try {
      const { entry } = await api.setPlanDay(date, body);
      setPlanEntries((prev) => {
        const rest = prev.filter((e) => e.date !== date);
        const anything = entry.note || MEAL_SLOTS.some((s) => entry.meals[s.key]?.length);
        return anything ? [...rest, entry] : rest;
      });
      return entry;
    } catch (e) {
      toast(e.message);
    }
  }

  // Which slot the picker was opened on, then shut it. The sheet closes as
  // the write goes out, so the day and meal have to be read first
  function closePicker() {
    const { day, slot } = picking;
    setPicking(null);
    return { date: isoDate(day.date), meal: slot.key };
  }

  /** What's already on a meal, as the write body wants it back, in render order. */
  function mealItems(date, meal) {
    const entry = planEntries.find((e) => e.date === date);
    return (entry?.meals?.[meal] || []).map((m) =>
      m.type === 'recipe' ? { type: 'recipe', recipeId: m.recipe?.id } : { type: m.type, text: m.text }
    );
  }

  // A meal that still points at a deleted or unfriended recipe can't be written
  // back, since there's no recipe left to name, so rewriting the meal quietly drops
  // the slot that already reads "Recipe unavailable".
  const writable = (list) => list.filter((m) => m.type !== 'recipe' || m.recipeId);

  // A meal is replaced wholesale, so adding one dish means sending the ones
  // already there alongside it, and dropping one means sending the rest.
  const addToMeal = (date, meal, item) =>
    savePlanDay(date, { [meal]: [...writable(mealItems(date, meal)), item] });

  function clearPlanItem(date, slot, index) {
    const rest = writable(mealItems(date, slot.key).filter((_, i) => i !== index));
    return savePlanDay(date, { [slot.key]: rest });
  }

  // Planning from the recipe screen, where the week on show isn't the week the
  // plan screen happens to have loaded. A meal is written back whole, so what's
  // already on it is read fresh rather than taken from planEntries, which could
  // be another week's or not loaded at all: a stale read would silently drop
  // whatever else was on that meal.
  async function planRecipeOn(date, meal, recipeId) {
    try {
      const { entries } = await api.plan(date, date);
      const already = (entries.find((e) => e.date === date)?.meals?.[meal] || []).map((m) =>
        m.type === 'recipe' ? { type: 'recipe', recipeId: m.recipe?.id } : { type: m.type, text: m.text }
      );
      await savePlanDay(date, { [meal]: [...writable(already), { type: 'recipe', recipeId }] });
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  // Every recipe you could plan: yours plus your friends', labelled by owner
  const plannableRecipes = [
    ...myRecipes.map((r) => ({ ...r, ownerLabel: 'Yours' })),
    ...allFriendRecipes.map((r) => ({ ...r, ownerLabel: r.ownerName })),
  ];

  // The shopping, by aisle. One list rather than a week's: what the plan calls
  // for is put on it from the plan screen, so nothing here is worked out and
  // nothing changes under you between looking and shopping.
  const grocery = groupGroceries(groceryItems);

  // Ticks are the one thing that stays in the browser: they're a scratchpad for
  // one trip round the shop, not worth a round trip while you're standing in an
  // aisle with one bar of signal. Keyed by the row's id, and cleared for good at
  // the end of a shop.
  function toggleGroceryChecked(key) {
    setGroceryChecked((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      localStorage.setItem('rb-grocery-v4', JSON.stringify(next));
      return next;
    });
  }

  // The API reads one line as the run of items it may be ("milk, eggs and
  // bread"), so what comes back is a list however it was typed or dictated.
  async function addGroceryItem(text, section) {
    try {
      const { items } = await api.addGroceryItem(text, section);
      setGroceryItems((prev) => [...prev, ...items]);
      if (items.length > 1) toast(`${items.length} items added`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeGroceryItem(item) {
    try {
      await api.removeGroceryItem(item.id);
      setGroceryItems((prev) => prev.filter((x) => x.id !== item.id));
    } catch (e) {
      toast(e.message);
    }
  }

  // Reworded for good: a line reads the way you last wrote it, whether it was
  // typed or came off a recipe whose wording suits the kitchen better than the
  // shop ("2 lb chicken thighs, boneless" is not how you buy them).
  async function renameGroceryItem(item, text) {
    try {
      const { item: saved } = await api.updateGroceryItem(item.id, text);
      setGroceryItems((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      toast(e.message);
    }
  }

  // The planning is done: everything the week calls for goes on the list, minus
  // what the kitchen already has and what the list already carries.
  async function addPlanToGroceries() {
    if (shopping) return;
    setShopping(true);
    try {
      const { items, alreadyOn, skipped } = await api.addPlanToGroceries(weekStart, weekEnd);
      setGroceryItems((prev) => [...prev, ...items]);
      const also = [
        alreadyOn ? `${alreadyOn} already on it` : null,
        skipped.length ? `${skipped.length} in your kitchen` : null,
      ].filter(Boolean);
      toast(
        items.length
          ? `${items.length} added${also.length ? ` · ${also.join(' · ')}` : ''}`
          : also.length
            ? `Nothing new: ${also.join(' · ')}`
            : 'Nothing on the plan to shop for'
      );
    } catch (e) {
      toast(e.message);
    } finally {
      setShopping(false);
    }
  }

  // The end of a trip round the shop: what's in the trolley was bought, so it
  // comes off the list, and the ticks go with it.
  async function finishShop() {
    const done = Object.keys(groceryChecked);
    if (!done.length) return;
    try {
      const { removed } = await api.clearGroceries(done);
      setGroceryItems((prev) => prev.filter((x) => !groceryChecked[x.id]));
      setGroceryChecked({});
      localStorage.removeItem('rb-grocery-v4');
      toast(`${removed} off the list`);
    } catch (e) {
      toast(e.message);
    }
  }

  // One typed or dictated line can carry a shelf's worth of items, so each is
  // added in turn and the result reported once rather than a toast per item.
  async function addPantryItem(location, text) {
    const added = [];
    let already = 0;
    for (const line of splitSpokenEntries(text)) {
      try {
        const { item } = await api.addPantryItem(location, line);
        added.push(item);
      } catch (e) {
        if (/already/i.test(e.message)) already++;
        else toast(e.message);
      }
    }
    if (added.length) setPantry((prev) => [...prev, ...added]);
    if (added.length > 1 || already) {
      const had = already ? ` · ${already} already there` : '';
      toast(`${added.length} ${added.length === 1 ? 'item' : 'items'} added${had}`);
    }
    return added;
  }

  // Handed back so a rename taken mid-inventory can move that walk's count too:
  // "beans" reworded to "3 cans beans" carries a new one.
  async function renamePantryItem(id, text) {
    try {
      const { item } = await api.renamePantryItem(id, text);
      setPantry((prev) => prev.map((x) => (x.id === item.id ? item : x)));
      return item;
    } catch (e) {
      toast(e.message);
      return null;
    }
  }

  // Stepping a count up or down from the shelf list, outside taking inventory
  async function setPantryQty(item, qty) {
    setPantry((prev) => prev.map((x) => (x.id === item.id ? { ...x, qty } : x)));
    try {
      const { item: saved } = await api.setPantryQty(item.id, qty);
      setPantry((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      setPantry((prev) => prev.map((x) => (x.id === item.id ? item : x)));
      toast(e.message);
    }
  }

  async function removePantryItem(item) {
    try {
      await api.removePantryItem(item.id);
      setPantry((prev) => prev.filter((x) => x.id !== item.id));
      toast(`${item.name} removed`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function savePantryInventory(updates) {
    if (!updates.length) {
      toast('Pantry up to date');
      return;
    }
    try {
      const { items, removed } = await api.savePantryInventory(updates);
      setPantry(items);
      toast(removed === 0 ? 'Pantry up to date' : `${removed} ${removed === 1 ? 'item' : 'items'} removed`);
    } catch (e) {
      toast(e.message);
    }
  }

  function openRecipe(r, from) {
    setCurrentRecipe(r);
    setBackTo(from);
    setScreen('recipe');
  }

  // The plan and the grocery list hold recipe ids, not whole recipes
  async function openRecipeById(id, from) {
    try {
      const { recipe } = await api.getRecipe(id);
      openRecipe(recipe, from);
    } catch (e) {
      toast(e.message);
    }
  }

  async function openFriend(f) {
    setCurrentFriend(f);
    setFilters(EMPTY_FILTERS);
    setScreen('friend');
    const { recipes } = await api.friendRecipes(f.id);
    setFriendRecipes(recipes);
  }

  async function saveDraft(d, files) {
    if (!d.title.trim()) {
      toast('Give it a title');
      return;
    }
    const body = {
      title: d.title,
      prep: d.prep,
      cook: d.cook,
      servings: d.serv,
      tags: d.tags,
      ing: (d.ing || '').split('\n').map((x) => x.trim()).filter(Boolean),
      dir: (d.dirs || '').split('\n').map((x) => x.trim()).filter(Boolean),
      notes: d.notes,
      source: d.source,
      from: d.from ?? null,
      nut: d.nutImport || undefined,
      photoUrls: d.photoUrls,
    };
    try {
      let recipe;
      if (editingId) {
        ({ recipe } = await api.updateRecipe(editingId, body));
      } else {
        ({ recipe } = await api.createRecipe(body));
      }
      for (const f of files) {
        ({ recipe } = await api.addPhoto(recipe.id, f));
      }
      await loadAll();
      setCurrentRecipe(recipe);
      setBackTo('home');
      setScreen('recipe');
      setDraft(null);
      setEditingId(null);
      toast(editingId ? 'Recipe updated' : 'Recipe saved');
    } catch (e) {
      toast(e.message);
    }
  }

  async function deleteRecipe() {
    try {
      await api.deleteRecipe(editingId);
      await loadAll();
      setDraft(null);
      setEditingId(null);
      setCurrentRecipe(null);
      setScreen('home');
      toast('Recipe deleted');
    } catch (e) {
      toast(e.message);
    }
  }

  if (!booted || !config) {
    return (
      <div className="app" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'var(--faint)', fontSize: 14 }}>Loading…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app">
        <SignIn
          config={config}
          invite={invite && !invite.error ? invite : null}
          inviteToken={inviteToken}
          onSignedIn={handleSignedIn}
          onError={toast}
        />
        {invite?.error && (
          <div style={{ position: 'absolute', bottom: 30, left: 20, right: 20, textAlign: 'center', fontSize: 12.5, color: 'var(--red)' }}>
            {invite.error}
          </div>
        )}
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    );
  }

  if (connectRq) {
    return (
      <div className="app">
        <Connect user={user} rq={connectRq} onSignOut={signOut} />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    );
  }

  const showNav = ['home', 'friends', 'plan', 'groceries', 'pantry'].includes(screen);
  const activeList = screen === 'friend' ? friendRecipes : myRecipes;
  const filterResultCount = activeList.filter((r) => matchesFilters(r, filters)).length;
  const customTags = customTagsFrom([...myRecipes, ...allFriendRecipes]);

  return (
    <div className="app">
      {screen === 'home' && (
        <Home
          user={user}
          recipes={myRecipes}
          layout={layout}
          filters={filters}
          setSearch={(q) => setFilters({ ...filters, query: q })}
          openFilter={() => setSheet('filter')}
          clearFilters={() => setFilters({ ...filters, selMeals: [], selTags: [], rating: 0 })}
          sort={sort}
          toggleSort={() => setSort(nextSort(sort))}
          openRecipe={(r) => openRecipe(r, 'home')}
          openProfile={() => setSheet('profile')}
          startAdd={() => { setDraft(null); setEditingId(null); setScreen('add1'); }}
        />
      )}

      {screen === 'plan' && (
        <Plan
          weekOffset={weekOffset}
          setWeekOffset={setWeekOffset}
          entries={planEntries}
          onPick={(day, slot) => setPicking({ day, slot })}
          onClearItem={clearPlanItem}
          onClearDay={(date) => savePlanDay(date, Object.fromEntries(MEAL_SLOTS.map((s) => [s.key, null])))}
          onSaveNote={(date, note) => savePlanDay(date, { note })}
          onOpenRecipe={(id) => openRecipeById(id, 'plan')}
          onShop={addPlanToGroceries}
          shopping={shopping}
        />
      )}

      {screen === 'groceries' && (
        <Groceries
          sections={grocery.sections}
          total={grocery.total}
          checked={groceryChecked}
          onToggle={toggleGroceryChecked}
          onAdd={addGroceryItem}
          onRemove={removeGroceryItem}
          onRename={renameGroceryItem}
          onFinishShop={finishShop}
          onOpenRecipe={(id) => openRecipeById(id, 'groceries')}
        />
      )}

      {screen === 'pantry' && (
        <Pantry
          items={pantry}
          onAdd={addPantryItem}
          onRename={renamePantryItem}
          onRemove={removePantryItem}
          onSetQty={setPantryQty}
          onSaveInventory={savePantryInventory}
        />
      )}

      {screen === 'friends' && (
        <Friends
          user={user}
          friends={friends}
          allFriendRecipes={allFriendRecipes}
          filters={filters}
          setSearch={(q) => setFilters({ ...filters, query: q })}
          openFriend={openFriend}
          openRecipe={(r) => openRecipe(r, 'friends')}
          openInvite={() => setSheet('invite')}
        />
      )}

      {screen === 'friend' && currentFriend && (
        <FriendDetail
          friend={currentFriend}
          recipes={friendRecipes}
          filters={filters}
          setSearch={(q) => setFilters({ ...filters, query: q })}
          openFilter={() => setSheet('filter')}
          clearFilters={() => setFilters({ ...filters, selMeals: [], selTags: [], rating: 0 })}
          sort={sort}
          toggleSort={() => setSort(nextSort(sort))}
          goFriends={() => { setScreen('friends'); setFilters(EMPTY_FILTERS); }}
          openRecipe={(r) => openRecipe(r, 'friend')}
          openRemove={() => setSheet('remove')}
        />
      )}

      {screen === 'recipe' && currentRecipe && (
        <Recipe
          key={currentRecipe.id}
          recipe={currentRecipe}
          user={user}
          isMine={isMine}
          savedAlready={savedAlready}
          goBack={() => setScreen(['friend', 'friends', 'plan', 'groceries'].includes(backTo) ? backTo : 'home')}
          onEdit={() => {
            setDraft({
              title: currentRecipe.title,
              prep: String(currentRecipe.prep),
              cook: String(currentRecipe.cook),
              serv: String(currentRecipe.servings),
              ing: currentRecipe.ing.join('\n'),
              dirs: currentRecipe.dir.join('\n'),
              tags: [...currentRecipe.tags],
              notes: currentRecipe.notes || '',
              source: currentRecipe.source || null,
              from: currentRecipe.from || null,
              photoUrls: [],
            });
            setEditingId(currentRecipe.id);
            setScreen('add2');
          }}
          onShare={() => setSheet('share')}
          onAddToPlan={() => setSheet('plan')}
          onSaveToMine={async () => {
            try {
              await api.saveRecipe(currentRecipe.id);
              await loadAll();
              toast('Saved to your recipes');
            } catch (e) {
              toast(e.message);
            }
          }}
          onUpdateNotes={async (notes) => {
            const { recipe } = await api.updateRecipe(currentRecipe.id, { notes });
            applyRecipe(recipe);
          }}
          onUpdateNut={async (nut, edited) => {
            const { recipe } = await api.updateRecipe(currentRecipe.id, { nut, nutEdited: edited });
            applyRecipe(recipe);
          }}
          onRate={async (rating) => {
            try {
              const { recipe } = await api.rateRecipe(currentRecipe.id, rating);
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
          }}
          onAddComment={async (text, photo) => {
            const { recipe } = await api.addComment(currentRecipe.id, text, photo);
            applyRecipe(recipe);
            toast('Comment posted');
          }}
          onDeleteComment={async (commentId) => {
            try {
              const { recipe } = await api.deleteComment(currentRecipe.id, commentId);
              applyRecipe(recipe);
              toast('Comment deleted');
            } catch (e) {
              toast(e.message);
            }
          }}
          onAddPhoto={async (files) => {
            // Uploaded one at a time so a single bad file doesn't sink the batch
            let recipe = null;
            let failed = 0;
            for (const file of [].concat(files)) {
              try {
                ({ recipe } = await api.addPhoto(currentRecipe.id, file));
              } catch (e) {
                failed++;
                toast(e.message);
              }
            }
            if (recipe) applyRecipe(recipe);
            const added = [].concat(files).length - failed;
            if (added > 1) toast(`Added ${added} photos`);
          }}
          onRemovePhoto={async (photoId) => {
            const { recipe } = await api.removePhoto(currentRecipe.id, photoId);
            applyRecipe(recipe);
          }}
        />
      )}

      {screen === 'add1' && (
        <AddStep1
          onCancel={() => setScreen('home')}
          onDraft={(d) => { setDraft(d); setScreen('add2'); }}
          toast={toast}
          canScan={config.scanEnabled}
        />
      )}

      {screen === 'add2' && draft && (
        <AddStep2
          draft={draft}
          editing={!!editingId}
          knownTags={customTags}
          onBack={() => {
            if (editingId) {
              setEditingId(null);
              setDraft(null);
              setScreen('recipe');
            } else {
              setScreen('add1');
            }
          }}
          onSave={saveDraft}
          onDelete={deleteRecipe}
        />
      )}

      {showNav && (
        <TabBar
          screen={screen}
          onHome={() => { setScreen('home'); setFilters({ ...filters, query: '' }); }}
          onPlan={() => setScreen('plan')}
          onGroceries={() => setScreen('groceries')}
          onPantry={() => setScreen('pantry')}
          onFriends={() => { setScreen('friends'); setFilters({ ...filters, query: '' }); }}
        />
      )}

      {sheet === 'profile' && (
        <ProfileSheet
          user={user}
          layout={layout}
          setLayout={(l) => { setLayout(l); localStorage.setItem('rb-layout', l); }}
          onClose={() => setSheet(null)}
          onSaved={setUser}
          onSignOut={signOut}
          onOpenKeys={() => setSheet('keys')}
          toast={toast}
        />
      )}
      {sheet === 'keys' && <ApiKeysSheet onClose={() => setSheet(null)} toast={toast} />}
      {sheet === 'filter' && (
        <FilterSheet filters={filters} setFilters={setFilters} customTags={customTags} resultCount={filterResultCount} onClose={() => setSheet(null)} />
      )}
      {sheet === 'share' && currentRecipe && (
        <ShareSheet recipe={currentRecipe} onClose={() => setSheet(null)} toast={toast} />
      )}
      {sheet === 'invite' && <InviteSheet onClose={() => setSheet(null)} toast={toast} />}

      {sheet === 'plan' && currentRecipe && (
        <PlanRecipeSheet
          title={currentRecipe.title}
          onClose={() => setSheet(null)}
          onPick={async (date, slot, dayName) => {
            const ok = await planRecipeOn(date, slot.key, currentRecipe.id);
            setSheet(null);
            if (ok) toast(`On ${dayName} ${slot.label.toLowerCase()}`);
          }}
        />
      )}

      {picking && (
        <PlanPickerSheet
          dayName={picking.day.name}
          mealLabel={picking.slot.label}
          already={mealItems(isoDate(picking.day.date), picking.slot.key).length}
          recipes={plannableRecipes}
          onClose={() => setPicking(null)}
          toast={toast}
          onPickRecipe={async (r, surprise) => {
            const { date, meal } = closePicker();
            await addToMeal(date, meal, { type: 'recipe', recipeId: r.id });
            if (surprise) toast(`Surprise: ${r.title}`);
          }}
          onPickLeftovers={() => {
            const { date, meal } = closePicker();
            addToMeal(date, meal, { type: 'leftovers' });
          }}
          onPickText={(text) => {
            const { date, meal } = closePicker();
            addToMeal(date, meal, { type: 'text', text });
          }}
        />
      )}

      {sheet === 'remove' && currentFriend && (
        <RemoveFriendSheet
          friend={currentFriend}
          onClose={() => setSheet(null)}
          onConfirm={async () => {
            try {
              await api.removeFriend(currentFriend.id);
              const name = currentFriend.name;
              setSheet(null);
              setScreen('friends');
              setCurrentFriend(null);
              await loadAll();
              toast(`${name} removed`);
            } catch (e) {
              toast(e.message);
            }
          }}
        />
      )}

      {toastMsg && <div className="toast">{toastMsg}</div>}
    </div>
  );
}
