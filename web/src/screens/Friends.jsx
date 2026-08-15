import { Avatar, RecipeRow, FilterSortBar } from '../components.jsx';
import { matchesFilters, sortRecipes } from '../util.js';

export function Friends({
  user, friends, allFriendRecipes, filters, setSearch, openFriend, openRecipe, openInvite,
}) {
  const q = filters.query.trim();
  const searchItems = q
    ? allFriendRecipes.filter((r) => matchesFilters(r, { selMeals: [], selTags: [], query: q }))
    : [];

  return (
    <div className="screen">
      <div className="top-row" style={{ paddingBottom: 12 }}>
        <div className="h1">Friends</div>
        {user.isAdmin && (
          <button className="btn-pill-outline" onClick={openInvite}>+ Invite</button>
        )}
      </div>
      <div style={{ padding: '0 20px 10px' }}>
        <input
          className="input"
          placeholder="Search all your friends' recipes"
          value={filters.query}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {q ? (
          <>
            {searchItems.map((r) => (
              <RecipeRow key={r.id} recipe={r} metaPrefix={r.ownerName} onOpen={() => openRecipe(r)} />
            ))}
            {searchItems.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 14, padding: '48px 20px' }}>
                No friend recipes match.
              </div>
            )}
          </>
        ) : (
          <>
            {friends.map((f) => (
              <button
                key={f.id}
                className="recipe-row"
                style={{ padding: '12px 14px' }}
                onClick={() => openFriend(f)}
              >
                <Avatar user={f} size={44} fontSize={17} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 600 }}>{f.name}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
                    {f.recipeCount} {f.recipeCount === 1 ? 'recipe' : 'recipes'}
                  </div>
                </div>
                <div className="chev">›</div>
              </button>
            ))}
            <div style={{ marginTop: 8, background: 'var(--green-soft)', borderRadius: 14, padding: 16, textAlign: 'center' }}>
              <div style={{ fontSize: 13.5, color: '#4c5a4c', lineHeight: 1.5 }}>
                Recipe Book is invite only.
                <br />
                {user.isAdmin ? 'Text a friend a link to join.' : 'Only the group admin can invite new members.'}
              </div>
              {user.isAdmin && (
                <button className="btn-pill-solid" style={{ marginTop: 10, borderRadius: 10, padding: '9px 18px', fontSize: 13.5 }} onClick={openInvite}>
                  Invite a friend
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function FriendDetail({
  friend, recipes, filters, setSearch, openFilter, clearFilters, sort, toggleSort,
  goFriends, openRecipe, openRemove,
}) {
  const items = sortRecipes(recipes.filter((r) => matchesFilters(r, filters)), sort);
  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn-link" onClick={goFriends}>‹ Friends</button>
        <button
          className="btn-pill-outline"
          style={{ borderColor: 'var(--red-bd)', color: 'var(--red)', padding: '7px 14px' }}
          onClick={openRemove}
        >
          Remove
        </button>
      </div>
      <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <Avatar user={friend} size={44} fontSize={17} />
        <div>
          <div style={{ fontSize: 21, fontWeight: 700, letterSpacing: -0.3 }}>{friend.name}&rsquo;s recipes</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {recipes.length} {recipes.length === 1 ? 'recipe' : 'recipes'}
          </div>
        </div>
      </div>
      <div style={{ padding: '2px 20px 10px' }}>
        <input
          className="input"
          placeholder={`Search ${friend.name}'s recipes`}
          value={filters.query}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <FilterSortBar
        filters={filters}
        onOpenFilter={openFilter}
        onClear={clearFilters}
        sort={sort}
        onToggleSort={toggleSort}
      />
      <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((r) => (
          <RecipeRow key={r.id} recipe={r} onOpen={() => openRecipe(r)} />
        ))}
        {items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 14, padding: '48px 20px' }}>
            No recipes match.
          </div>
        )}
      </div>
    </div>
  );
}
