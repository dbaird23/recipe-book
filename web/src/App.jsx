import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { TabBar } from './components.jsx';
import SignIn from './screens/SignIn.jsx';
import Home from './screens/Home.jsx';
import { Friends, FriendDetail } from './screens/Friends.jsx';
import Recipe from './screens/Recipe.jsx';
import { AddStep1, AddStep2 } from './screens/Add.jsx';
import { ProfileSheet, FilterSheet, ShareSheet, InviteSheet, RemoveFriendSheet } from './sheets.jsx';
import { matchesFilters, customTagsFrom } from './util.js';

const EMPTY_FILTERS = { selMeals: [], selTags: [], query: '' };

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

  const [sheet, setSheet] = useState(null); // 'profile' | 'filter' | 'share' | 'invite' | 'remove'
  const [toastMsg, setToastMsg] = useState(null);
  const toastTimer = useRef(null);

  const toast = useCallback((msg) => {
    clearTimeout(toastTimer.current);
    setToastMsg(msg);
    toastTimer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  const loadAll = useCallback(async () => {
    const [mine, fr, all] = await Promise.all([api.myRecipes(), api.friends(), api.allFriendRecipes()]);
    setMyRecipes(mine.recipes);
    setFriends(fr.friends);
    setAllFriendRecipes(all.recipes);
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

  const showNav = screen === 'home' || screen === 'friends';
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
          clearFilters={() => setFilters({ ...filters, selMeals: [], selTags: [] })}
          sort={sort}
          toggleSort={() => setSort(sort === 'alpha' ? 'newest' : 'alpha')}
          openRecipe={(r) => openRecipe(r, 'home')}
          openProfile={() => setSheet('profile')}
          startAdd={() => { setDraft(null); setEditingId(null); setScreen('add1'); }}
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
          clearFilters={() => setFilters({ ...filters, selMeals: [], selTags: [] })}
          sort={sort}
          toggleSort={() => setSort(sort === 'alpha' ? 'newest' : 'alpha')}
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
          goBack={() => setScreen(backTo === 'friend' ? 'friend' : backTo === 'friends' ? 'friends' : 'home')}
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
          onAddComment={async (text, photo) => {
            const { recipe } = await api.addComment(currentRecipe.id, text, photo);
            applyRecipe(recipe);
            toast('Comment posted');
          }}
          onAddPhoto={async (file) => {
            try {
              const { recipe } = await api.addPhoto(currentRecipe.id, file);
              applyRecipe(recipe);
            } catch (e) {
              toast(e.message);
            }
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
          toast={toast}
        />
      )}
      {sheet === 'filter' && (
        <FilterSheet filters={filters} setFilters={setFilters} customTags={customTags} resultCount={filterResultCount} onClose={() => setSheet(null)} />
      )}
      {sheet === 'share' && currentRecipe && (
        <ShareSheet recipe={currentRecipe} onClose={() => setSheet(null)} toast={toast} />
      )}
      {sheet === 'invite' && <InviteSheet onClose={() => setSheet(null)} toast={toast} />}
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
