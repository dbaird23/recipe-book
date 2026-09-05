import { useCallback, useEffect, useRef, useState } from 'react';
import { api, sendQueued } from './api.js';
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
import {
  matchesFilters, customTagsFrom, nextSort, groupGroceries, splitSpokenEntries, MEAL_SLOTS, mondayOf, addDays, isoDate,
  grocerySection, parsePantryEntry, cleanNut, autoNut, countIngredients,
} from './util.js';
import {
  net, readStore, writeStore, removeStore, tempId, attempt, flush, pending, subscribeQueue, clearQueue,
} from './offline.js';

const EMPTY_FILTERS = { selMeals: [], selTags: [], query: '', rating: 0 };
const DEFAULT_CONFIG = { googleEnabled: false, devLoginEnabled: true, googleClientId: null, scanEnabled: false };

// What the server last said, kept so the app opens on it with no signal. The
// book is everything the home, friends, pantry and grocery screens show; the
// plan is kept a week at a time, for the weeks that have been looked at.
const CACHE = { config: 'rb-cache-config', user: 'rb-cache-user', book: 'rb-cache-book', plan: 'rb-cache-plan' };
const PLAN_WEEKS_KEPT = 12;

function rememberPlanWeek(key, entries) {
  const all = readStore(CACHE.plan, {});
  delete all[key];
  const next = { ...all, [key]: entries };
  const keys = Object.keys(next);
  while (keys.length > PLAN_WEEKS_KEPT) delete next[keys.shift()];
  writeStore(CACHE.plan, next);
}

const emptyDay = (date) => ({ date, note: '', meals: { breakfast: [], lunch: [], dinner: [] } });

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
  const [groceryChecked, setGroceryChecked] = useState(() => readStore('rb-grocery-v4', {}));
  const [shopping, setShopping] = useState(false);
  // Lines reworded for this week's shop. A recipe's wording belongs to the
  // recipe, so the new words are kept here rather than written back to it.
  // pantry: what's already in the kitchen, so the grocery list can skip it
  const [pantry, setPantry] = useState([]);
  // groceries added by hand, alongside whatever the week's plan calls for
  const [groceryItems, setGroceryItems] = useState([]);

  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  // Whether the server can be reached, and how many writes are waiting for it
  const [online, setOnline] = useState(net.online);
  const [queued, setQueued] = useState(pending());
  // Set once the book on screen is real (from the server or the saved copy),
  // so the saved copy is only ever written from something worth keeping
  const bookLoaded = useRef(false);

  const toast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const applyBook = useCallback((book) => {
    setMyRecipes(book.myRecipes);
    setFriends(book.friends);
    setAllFriendRecipes(book.allFriendRecipes);
    setPantry(book.pantry);
    setGroceryItems(book.groceryItems);
    bookLoaded.current = true;
  }, []);

  // Everything the server holds for this account, or, when it can't be
  // reached, the copy saved last time it could. While writes made offline
  // are still waiting to go, the server's answer is left alone: it doesn't
  // know about them yet, and putting it on screen would make them vanish
  // until they'd been sent.
  const loadAll = useCallback(async () => {
    try {
      const [mine, fr, all, kitchen, list] = await Promise.all([
        api.myRecipes(), api.friends(), api.allFriendRecipes(), api.pantry(), api.groceries(),
      ]);
      if (pending() && bookLoaded.current) return;
      applyBook({
        myRecipes: mine.recipes, friends: fr.friends, allFriendRecipes: all.recipes, pantry: kitchen.items, groceryItems: list.items,
      });
    } catch (e) {
      if (!e.offline) throw e;
      // A refresh that fails leaves what's on screen; a first load that fails opens on the saved copy
      if (bookLoaded.current) return;
      const saved = readStore(CACHE.book);
      if (!saved) throw e;
      applyBook(saved);
    }
  }, [applyBook]);

  // The saved copy follows the book on screen, including what's been changed
  // offline, so closing the app with no signal loses nothing
  useEffect(() => {
    if (!user || !bookLoaded.current) return;
    writeStore(CACHE.book, { myRecipes, friends, allFriendRecipes, pantry, groceryItems, savedAt: Date.now() });
  }, [user, myRecipes, friends, allFriendRecipes, pantry, groceryItems]);

  useEffect(() => {
    if (user) writeStore(CACHE.user, user);
  }, [user]);

  // Send what was written while away, then read the book back from the
  // server, which now has the real ids for anything made offline. Says
  // whether it did, so a caller that would read the book anyway needn't twice.
  const syncUp = useCallback(async () => {
    if (!pending() || !net.online) return false;
    const { sent, failed, idMap } = await flush(sendQueued);
    if (failed.length === 1) toast(`Couldn\u2019t save ${failed[0].entry.label}: ${failed[0].error.message}`);
    else if (failed.length) toast(`${failed.length} changes made offline couldn\u2019t be saved`);
    if (!sent) return false;
    // Ticks and the open recipe were keyed by ids handed out offline
    const swap = (id) => idMap[id] || id;
    setGroceryChecked((prev) => {
      const next = Object.fromEntries(Object.keys(prev).map((k) => [swap(k), true]));
      writeStore('rb-grocery-v4', next);
      return next;
    });
    setCurrentRecipe((r) => (r && idMap[r.id] ? { ...r, id: idMap[r.id] } : r));
    setEditingId((id) => (id ? swap(id) : id));
    await loadAll().catch(() => {});
    setResumedAt(Date.now());
    if (!failed.length) toast(sent === 1 ? 'Saved what you did offline' : `Saved ${sent} changes made offline`);
    return true;
  }, [loadAll, toast]);

  // The connection coming back, or something new joining the queue while
  // it's there, is the moment to send. While it isn't there, ask again now
  // and then: a phone that says it's online with nothing behind it never
  // raises the event that would say otherwise.
  useEffect(() => {
    // Read at mount as well as on change: the first requests of a session go
    // out before anything is listening, and they're the ones that find out
    const sync = () => { setOnline(net.online); setQueued(pending()); };
    sync();
    const unsubNet = net.subscribe(sync);
    const unsubQueue = subscribeQueue(sync);
    return () => { unsubNet(); unsubQueue(); };
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsubNet = net.subscribe(() => {
      if (net.online) syncUp().then((reloaded) => reloaded || loadAll()).catch(() => {});
    });
    const unsubQueue = subscribeQueue(() => {
      if (net.online) syncUp().catch(() => {});
    });
    const timer = setInterval(() => {
      if (!net.online) api.config().catch(() => {});
      else if (pending()) syncUp().catch(() => {});
    }, 20000);
    return () => { unsubNet(); unsubQueue(); clearInterval(timer); };
  }, [user, syncUp, loadAll]);

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
      syncUp().then((reloaded) => reloaded || loadAll()).catch(() => {});
      setResumedAt(Date.now());
    };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [user, loadAll, syncUp]);

  // Boot: config, invite path, session, deep link
  useEffect(() => {
    (async () => {
      // With no signal, the config and the account are whatever they were last time
      const cfg = await api.config().then(
        (c) => { writeStore(CACHE.config, c); return c; },
        (e) => (e.offline && readStore(CACHE.config)) || DEFAULT_CONFIG
      );
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
        let u;
        try {
          ({ user: u } = await api.me());
        } catch (e) {
          if (!e.offline) throw e;
          u = readStore(CACHE.user);
          if (!u) throw e;
        }
        setUser(u);
        // The consent screen needs nothing but the account, and this tab is
        // about to leave for whoever asked, so don't pull the whole book in.
        // Anything written offline last time goes first, so the book read
        // back has it.
        if (!connecting) {
          await syncUp().catch(() => {});
          await loadAll();
        }
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
  }, [loadAll, syncUp]);

  async function handleSignedIn(u) {
    setUser(u);
    if (inviteToken) history.replaceState(null, '', '/');
    if (!connectRq) await loadAll();
  }

  async function signOut() {
    try {
      await api.logout();
    } catch (e) {
      toast(e.message);
      return;
    }
    // The saved copy belongs to the account that's leaving
    bookLoaded.current = false;
    for (const key of [CACHE.user, CACHE.book, CACHE.plan, 'rb-grocery-v4']) removeStore(key);
    clearQueue();
    setGroceryChecked({});
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
  const weekKey = `${weekStart}:${weekEnd}`;

  useEffect(() => {
    if (!user || (screen !== 'plan' && screen !== 'groceries')) return;
    let stale = false;
    api
      .plan(weekStart, weekEnd)
      .then(({ entries }) => {
        if (stale) return;
        setPlanEntries(entries);
        rememberPlanWeek(weekKey, entries);
      })
      .catch((e) => {
        if (stale) return;
        if (!e.offline) return toast(e.message);
        // The week as it was last seen, changes made offline included
        const saved = readStore(CACHE.plan, {})[weekKey];
        setPlanEntries(saved || []);
        if (!saved) toast('You\u2019re offline, and this week hasn\u2019t been looked at yet');
      });
    return () => { stale = true; };
  }, [user, screen, weekStart, weekEnd, resumedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A recipe as a planned meal carries it: enough to draw the row and open it. */
  function planRecipeOf(id) {
    const r = plannableRecipes.find((x) => x.id === id);
    if (!r) return null;
    return {
      id: r.id, title: r.title, ownerId: r.ownerId, ownerName: r.ownerName, mine: r.ownerId === user.id,
      prep: r.prep, cook: r.cook, servings: r.servings, ing: r.ing, photoUrl: r.photos?.[0]?.url || null,
    };
  }

  // The day as the server would hand it back after this write, worked out
  // here for when the server can't be asked
  function localPlanDay(entries, date, body) {
    const current = entries.find((e) => e.date === date) || emptyDay(date);
    const meals = { ...current.meals };
    for (const s of MEAL_SLOTS) {
      if (!(s.key in body)) continue;
      const wanted = body[s.key] === null ? [] : [].concat(body[s.key]);
      meals[s.key] = wanted.map((d) =>
        d.type === 'recipe'
          ? { id: tempId(), type: 'recipe', text: null, recipe: planRecipeOf(d.recipeId) }
          : { id: tempId(), type: d.type, text: d.type === 'text' ? String(d.text || '').trim().slice(0, 120) : null, recipe: null }
      );
    }
    const note = 'note' in body ? String(body.note || '').trim().slice(0, 200) : current.note;
    return { date, note, meals };
  }

  function putPlanDay(entry, key = weekKey) {
    setPlanEntries((prev) => {
      const rest = prev.filter((e) => e.date !== entry.date);
      const anything = entry.note || MEAL_SLOTS.some((s) => entry.meals[s.key]?.length);
      const next = anything ? [...rest, entry] : rest;
      rememberPlanWeek(key, next);
      return next;
    });
  }

  async function savePlanDay(date, body) {
    try {
      const { entry } = await attempt(
        () => api.setPlanDay(date, body),
        { method: 'PUT', path: `/api/plan/${date}`, body, label: 'a change to the plan' },
        () => ({ entry: localPlanDay(planEntries, date, body) })
      );
      putPlanDay(entry);
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
  //
  // Offline, the fresh read is the saved copy of the week the day falls in.
  // A week never looked at has no copy, and guessing the meal empty could
  // wipe what's on it, so that one waits for a connection.
  async function planRecipeOn(date, meal, recipeId) {
    try {
      let entries;
      let key = weekKey;
      try {
        ({ entries } = await api.plan(date, date));
      } catch (e) {
        if (!e.offline) throw e;
        const monday = new Date(`${date}T12:00:00`);
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
        key = `${isoDate(monday)}:${isoDate(addDays(monday, 6))}`;
        entries = readStore(CACHE.plan, {})[key];
        if (!entries) throw new Error('You\u2019re offline, and that week hasn\u2019t been looked at yet');
      }
      const already = (entries.find((e) => e.date === date)?.meals?.[meal] || []).map((m) =>
        m.type === 'recipe' ? { type: 'recipe', recipeId: m.recipe?.id } : { type: m.type, text: m.text }
      );
      const body = { [meal]: [...writable(already), { type: 'recipe', recipeId }] };
      const { entry } = await attempt(
        () => api.setPlanDay(date, body),
        { method: 'PUT', path: `/api/plan/${date}`, body, label: 'a change to the plan' },
        () => ({ entry: localPlanDay(entries, date, body) })
      );
      if (key === weekKey) putPlanDay(entry);
      else rememberPlanWeek(key, [...entries.filter((e) => e.date !== date), entry]);
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
    // What the server would make of the line, for when it can't be asked
    const guess = splitSpokenEntries(text).slice(0, 30).map((t) => ({
      id: tempId(), text: t.slice(0, 100), section: section || grocerySection(t), sources: [],
    }));
    try {
      const { items } = await attempt(
        () => api.addGroceryItem(text, section),
        {
          method: 'POST', path: '/api/groceries', body: { text, section }, label: `adding ${text}`,
          made: { from: 'items', ids: guess.map((g) => g.id) },
        },
        () => ({ items: guess })
      );
      setGroceryItems((prev) => [...prev, ...items]);
      if (items.length > 1) toast(`${items.length} items added`);
    } catch (e) {
      toast(e.message);
    }
  }

  async function removeGroceryItem(item) {
    try {
      await attempt(
        () => api.removeGroceryItem(item.id),
        { method: 'DELETE', path: `/api/groceries/${item.id}`, label: `removing ${item.label || item.text}` },
        () => ({ ok: true })
      );
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
      const { item: saved } = await attempt(
        () => api.updateGroceryItem(item.id, text),
        { method: 'PATCH', path: `/api/groceries/${item.id}`, body: { text }, label: `rewording ${text}` },
        () => ({ item: { id: item.id, text: text.trim().slice(0, 100), section: grocerySection(text) } })
      );
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
      const { removed } = await attempt(
        () => api.clearGroceries(done),
        { method: 'POST', path: '/api/groceries/clear', body: { ids: done }, label: 'finishing the shop' },
        () => ({ removed: done.length })
      );
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
        const p = parsePantryEntry(line);
        const guess = { id: tempId(), location, name: p.name.slice(0, 80), qty: p.qty, unit: p.unit };
        const taken = [...pantry, ...added].some(
          (x) => x.location === location && x.name.toLowerCase() === guess.name.toLowerCase()
        );
        const { item } = await attempt(
          () => api.addPantryItem(location, line),
          { method: 'POST', path: '/api/pantry', body: { location, text: line }, label: `adding ${line}`, made: { from: 'item', ids: [guess.id] } },
          () => {
            if (!guess.name) throw new Error('Type something to add first');
            if (taken) throw new Error(`Already in your ${location}`);
            return { item: guess };
          }
        );
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
      const { item } = await attempt(
        () => api.renamePantryItem(id, text),
        { method: 'PATCH', path: `/api/pantry/${id}`, body: { text }, label: `rewording ${text}` },
        () => {
          const was = pantry.find((x) => x.id === id);
          const p = parsePantryEntry(text);
          if (!p.name) throw new Error('Type something to add first');
          const recount = p.hadQty || !was;
          return { item: { id, location: was?.location, name: p.name.slice(0, 80), qty: recount ? p.qty : was.qty, unit: recount ? p.unit : was.unit } };
        }
      );
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
      const { item: saved } = await attempt(
        () => api.setPantryQty(item.id, qty),
        { method: 'PATCH', path: `/api/pantry/${item.id}`, body: { qty }, label: `counting ${item.name}` },
        () => ({ item: { ...item, qty: Math.max(0, +qty || 0) } })
      );
      setPantry((prev) => prev.map((x) => (x.id === saved.id ? saved : x)));
    } catch (e) {
      setPantry((prev) => prev.map((x) => (x.id === item.id ? item : x)));
      toast(e.message);
    }
  }

  async function removePantryItem(item) {
    try {
      await attempt(
        () => api.removePantryItem(item.id),
        { method: 'DELETE', path: `/api/pantry/${item.id}`, label: `removing ${item.name}` },
        () => ({ ok: true })
      );
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
      const { items, removed } = await attempt(
        () => api.savePantryInventory(updates),
        { method: 'PUT', path: '/api/pantry', body: { items: updates }, label: 'taking inventory' },
        () => {
          const counts = new Map(updates.map((u) => [String(u.id), Math.max(0, +u.qty || 0)]));
          const kept = pantry
            .map((x) => (counts.has(x.id) ? { ...x, qty: counts.get(x.id) } : x))
            .filter((x) => !counts.has(x.id) || x.qty > 0);
          return { items: kept, removed: pantry.length - kept.length };
        }
      );
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

  // The plan and the grocery list hold recipe ids, not whole recipes. The
  // book on screen usually has it, and is the same shape the server sends,
  // so that's the copy opened: it's what's there with no signal, and it's
  // what's there at all for a recipe made offline.
  async function openRecipeById(id, from) {
    const known = [...myRecipes, ...allFriendRecipes, ...friendRecipes].find((r) => r.id === id);
    if (known) return openRecipe(known, from);
    try {
      const { recipe } = await api.getRecipe(id);
      openRecipe(recipe, from);
    } catch (e) {
      toast(e.message);
    }
  }

  // A friend's shelf is their part of the friends' recipes already loaded,
  // shown at once and then read fresh where there's a connection
  async function openFriend(f) {
    setCurrentFriend(f);
    setFilters(EMPTY_FILTERS);
    setScreen('friend');
    setFriendRecipes(allFriendRecipes.filter((r) => r.ownerId === f.id));
    try {
      const { recipes } = await api.friendRecipes(f.id);
      setFriendRecipes(recipes);
    } catch (e) {
      if (!e.offline) toast(e.message);
    }
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
    // The recipe as the server will hand it back, for when it can't be asked
    const newId = tempId();
    const localRecipe = () => {
      const clean = (v) => String(v ?? '').trim();
      const list = (v) => (Array.isArray(v) ? v.map(clean).filter(Boolean) : []);
      const fields = {
        title: clean(body.title), prep: Math.max(0, +body.prep || 0), cook: Math.max(0, +body.cook || 0),
        servings: Math.max(1, +body.servings || 1), tags: list(body.tags), ing: list(body.ing), dir: list(body.dir),
        notes: clean(body.notes), source: clean(body.source) || null, from: clean(body.from) || null,
      };
      const was = editingId ? currentRecipe : null;
      const keepNut = was?.nutEdited ? was.nut : autoNut(countIngredients(fields.ing));
      const recipe = was
        ? { ...was, ...fields, source: fields.source ?? was.source, nut: keepNut }
        : {
            id: newId, ownerId: user.id, ownerName: user.name, ...fields,
            nut: body.nut ? cleanNut(body.nut) : keepNut, nutEdited: !!body.nut, rating: 0,
            createdAt: new Date().toISOString(), comments: [],
            photos: (body.photoUrls || []).filter((u) => /^https?:\/\//.test(u)).slice(0, 8).map((url, i) => ({ id: tempId(), url, position: i })),
          };
      return { recipe };
    };
    try {
      let recipe;
      if (files.length) {
        // The photos can't wait in the queue (a file is not a thing the
        // browser will keep for us), so the recipe doesn't either: with no
        // signal, the draft stays put and says why
        if (editingId) ({ recipe } = await api.updateRecipe(editingId, body));
        else ({ recipe } = await api.createRecipe(body));
      } else if (editingId) {
        ({ recipe } = await attempt(
          () => api.updateRecipe(editingId, body),
          { method: 'PATCH', path: `/api/recipes/${editingId}`, body, label: `the edit to ${body.title}` },
          localRecipe
        ));
      } else {
        ({ recipe } = await attempt(
          () => api.createRecipe(body),
          { method: 'POST', path: '/api/recipes', body, label: `the recipe ${body.title}`, made: { from: 'recipe', ids: [newId] } },
          localRecipe
        ));
      }
      for (const f of files) {
        ({ recipe } = await api.addPhoto(recipe.id, f));
      }
      // The book on screen gets it now, and the server's copy replaces it
      // when the server can be read
      if (editingId) applyRecipe(recipe);
      else setMyRecipes((prev) => [recipe, ...prev]);
      await loadAll().catch(() => {});
      setCurrentRecipe(recipe);
      setBackTo('home');
      setScreen('recipe');
      setDraft(null);
      setEditingId(null);
      toast(editingId ? 'Recipe updated' : 'Recipe saved');
    } catch (e) {
      toast(e.offline && files.length ? 'Photos need a connection: drop them to save now, or try again later' : e.message);
    }
  }

  async function deleteRecipe() {
    try {
      await attempt(
        () => api.deleteRecipe(editingId),
        { method: 'DELETE', path: `/api/recipes/${editingId}`, label: 'deleting a recipe' },
        () => ({ ok: true })
      );
      setMyRecipes((prev) => prev.filter((r) => r.id !== editingId));
      await loadAll().catch(() => {});
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

  const offlineBar = (!online || queued > 0) && (
    <div className="offline-bar" role="status">
      {!online
        ? queued
          ? `Offline \u00b7 ${queued} ${queued === 1 ? 'change' : 'changes'} will be saved when you\u2019re back`
          : user
            ? 'Offline \u00b7 showing what was last saved'
            : 'Offline \u00b7 signing in needs a connection'
        : `Saving ${queued} ${queued === 1 ? 'change' : 'changes'}\u2026`}
    </div>
  );

  if (!user) {
    return (
      <div className="app">
        {offlineBar}
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
      {offlineBar}
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
            try {
              const { recipe } = await attempt(
                () => api.updateRecipe(currentRecipe.id, { notes }),
                { method: 'PATCH', path: `/api/recipes/${currentRecipe.id}`, body: { notes }, label: 'the notes' },
                () => ({ recipe: { ...currentRecipe, notes: notes.trim() } })
              );
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
          }}
          onUpdateNut={async (nut, edited) => {
            try {
              const { recipe } = await attempt(
                () => api.updateRecipe(currentRecipe.id, { nut, nutEdited: edited }),
                { method: 'PATCH', path: `/api/recipes/${currentRecipe.id}`, body: { nut, nutEdited: edited }, label: 'the nutrition' },
                () => ({ recipe: { ...currentRecipe, nut: cleanNut(nut), nutEdited: edited !== false } })
              );
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
          }}
          onRate={async (rating) => {
            try {
              const { recipe } = await attempt(
                () => api.rateRecipe(currentRecipe.id, rating),
                { method: 'PATCH', path: `/api/recipes/${currentRecipe.id}`, body: { rating }, label: 'the rating' },
                () => ({ recipe: { ...currentRecipe, rating: Math.round(+rating || 0) } })
              );
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
          }}
          onAddComment={async (text, photo) => {
            try {
              // A comment with a photo needs the connection; words alone can wait
              const { recipe } = photo
                ? await api.addComment(currentRecipe.id, text, photo)
                : await attempt(
                    () => api.addComment(currentRecipe.id, text, null),
                    { method: 'POST', path: `/api/recipes/${currentRecipe.id}/comments`, form: { text }, label: 'a comment' },
                    () => ({
                      recipe: {
                        ...currentRecipe,
                        comments: [
                          ...(currentRecipe.comments || []),
                          {
                            id: tempId(), text: text.trim(), photoUrl: null, createdAt: new Date().toISOString(),
                            author: { id: user.id, name: user.name, avatarUrl: user.avatarUrl || null },
                          },
                        ],
                      },
                    })
                  );
              applyRecipe(recipe);
              toast('Comment posted');
            } catch (e) {
              toast(e.offline && photo ? 'A photo needs a connection: post the words now, or try again later' : e.message);
            }
          }}
          onDeleteComment={async (commentId) => {
            try {
              const { recipe } = await attempt(
                () => api.deleteComment(currentRecipe.id, commentId),
                { method: 'DELETE', path: `/api/recipes/${currentRecipe.id}/comments/${commentId}`, label: 'deleting a comment' },
                () => ({ recipe: { ...currentRecipe, comments: (currentRecipe.comments || []).filter((c) => c.id !== commentId) } })
              );
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
            try {
              const { recipe } = await api.removePhoto(currentRecipe.id, photoId);
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
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
