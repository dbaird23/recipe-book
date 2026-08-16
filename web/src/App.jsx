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
import { ProfileSheet, ApiKeysSheet, FilterSheet, ShareSheet, InviteSheet, RemoveFriendSheet, PlanPickerSheet, GrocerySheet } from './sheets.jsx';
import { matchesFilters, customTagsFrom, nextSort, pantrySkip, DAY_NAMES, mondayOf, addDays, isoDate } from './util.js';

const EMPTY_FILTERS = { selMeals: [], selTags: [], query: '', rating: 0 };

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [booted, setBooted] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteToken, setInviteToken] = useState(null);

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

  const [sheet, setSheet] = useState(null); // 'profile' | 'keys' | 'filter' | 'share' | 'invite' | 'remove' | 'grocery'

  // meal plan
  const [weekOffset, setWeekOffset] = useState(0);
  const [planEntries, setPlanEntries] = useState([]);
  const [pickerDay, setPickerDay] = useState(null);
  const [groceryChecked, setGroceryChecked] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('rb-grocery') || '{}');
    } catch {
      return {};
    }
  });
  // pantry — what's already in the kitchen, so the grocery list can skip it
  const [pantry, setPantry] = useState([]);

  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const loadAll = useCallback(async () => {
    const [mine, fr, all, kitchen] = await Promise.all([
      api.myRecipes(), api.friends(), api.allFriendRecipes(), api.pantry(),
    ]);
    setMyRecipes(mine.recipes);
    setFriends(fr.friends);
    setAllFriendRecipes(all.recipes);
    setPantry(kitchen.items);
    return mine.recipes;
  }, []);

  // Boot: config, invite path, session, deep link
  useEffect(() => {
    (async () => {
      const cfg = await api.config().catch(() => ({ googleEnabled: false, devLoginEnabled: true, googleClientId: null }));
      setConfig(cfg);

      const inviteMatch = location.pathname.match(/^\/invite\/([a-f0-9]+)$/);
      if (inviteMatch) {
        setInviteToken(inviteMatch[1]);
        setInvite(await api.inviteInfo(inviteMatch[1]).catch((e) => ({ error: e.message })));
      }

      try {
        const { user: u } = await api.me();
        setUser(u);
        await loadAll();
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
          history.replaceState(null, '', import.meta.env.BASE_URL);
        }
      } catch {
        /* not signed in */
      }
      setBooted(true);
    })();
  }, [loadAll]);

  async function handleSignedIn(u) {
    setUser(u);
    if (inviteToken) history.replaceState(null, '', import.meta.env.BASE_URL);
    await loadAll();
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
    if (!user || screen !== 'plan') return;
    let stale = false;
    api
      .plan(weekStart, weekEnd)
      .then(({ entries }) => { if (!stale) setPlanEntries(entries); })
      .catch((e) => toast(e.message));
    return () => { stale = true; };
  }, [user, screen, weekStart, weekEnd]);

  async function savePlanDay(date, body) {
    try {
      const { entry } = await api.setPlanDay(date, body);
      setPlanEntries((prev) => {
        const rest = prev.filter((e) => e.date !== date);
        return entry.type || entry.note ? [...rest, entry] : rest;
      });
      return entry;
    } catch (e) {
      toast(e.message);
    }
  }

  // Every recipe you could plan: yours plus your friends', labelled by owner
  const plannableRecipes = [
    ...myRecipes.map((r) => ({ ...r, ownerLabel: 'Yours' })),
    ...allFriendRecipes.map((r) => ({ ...r, ownerLabel: r.ownerName })),
  ];

  // The week's shopping, minus whatever the pantry already covers. Skipped
  // lines are collected so the sheet can show its work — a loose name match
  // will occasionally drop something you did need.
  const skippedByText = new Map();
  const groceryGroups = DAY_NAMES.map((name, i) => {
    const date = isoDate(addDays(mondayOf(weekOffset), i));
    const entry = planEntries.find((e) => e.date === date);
    if (!entry?.recipe) return null;
    const items = entry.recipe.ing
      .map((text, j) => {
        const have = pantrySkip(text, pantry);
        if (have) skippedByText.set(text, have.location);
        return have ? null : { key: `${date}-${j}`, text };
      })
      .filter(Boolean);
    if (!items.length) return null;
    return { key: date, title: `${name.slice(0, 3).toUpperCase()} · ${entry.recipe.title.toUpperCase()}`, items };
  }).filter(Boolean);
  const grocerySkipped = [...skippedByText].map(([text, location]) => ({ text, location }));

  function openRecipe(r, from) {
    setCurrentRecipe(r);
    setBackTo(from);
    setScreen('recipe');
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

  const showNav = ['home', 'friends', 'plan', 'pantry'].includes(screen);
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
          onPick={(day) => setPickerDay(day)}
          onClear={(date) => savePlanDay(date, { dinner: null })}
          onSaveNote={(date, note) => savePlanDay(date, { note })}
          onOpenRecipe={async (id) => {
            try {
              const { recipe } = await api.getRecipe(id);
              openRecipe(recipe, 'plan');
            } catch (e) {
              toast(e.message);
            }
          }}
          onOpenGrocery={() => setSheet('grocery')}
        />
      )}

      {screen === 'pantry' && (
        <Pantry
          items={pantry}
          onAdd={addPantryItem}
          onRename={renamePantryItem}
          onRemove={removePantryItem}
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
          goBack={() => setScreen(['friend', 'friends', 'plan'].includes(backTo) ? backTo : 'home')}
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

      {pickerDay && (
        <PlanPickerSheet
          dayName={pickerDay.name}
          recipes={plannableRecipes}
          onClose={() => setPickerDay(null)}
          toast={toast}
          onPickRecipe={async (r, surprise) => {
            const date = isoDate(pickerDay.date);
            setPickerDay(null);
            await savePlanDay(date, { dinner: { type: 'recipe', recipeId: r.id } });
            if (surprise) toast(`Surprise: ${r.title}`);
          }}
          onPickLeftovers={() => {
            const date = isoDate(pickerDay.date);
            setPickerDay(null);
            savePlanDay(date, { dinner: { type: 'leftovers' } });
          }}
          onPickText={(text) => {
            const date = isoDate(pickerDay.date);
            setPickerDay(null);
            savePlanDay(date, { dinner: { type: 'text', text } });
          }}
        />
      )}

      {sheet === 'grocery' && (
        <GrocerySheet
          groups={groceryGroups}
          skipped={grocerySkipped}
          checked={groceryChecked}
          onToggle={(key) =>
            setGroceryChecked((prev) => {
              const next = { ...prev, [key]: !prev[key] };
              if (!next[key]) delete next[key];
              localStorage.setItem('rb-grocery', JSON.stringify(next));
              return next;
            })
          }
          onClose={() => setSheet(null)}
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
