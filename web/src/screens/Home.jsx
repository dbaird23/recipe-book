import { Avatar, RecipeRow, RecipeGridCard, FilterSortBar } from '../components.jsx';
import { matchesFilters, sortRecipes } from '../util.js';

export default function Home({
  user, recipes, layout, filters, setSearch, openFilter, clearFilters, sort, toggleSort,
  openRecipe, openProfile, startAdd,
}) {
  const items = sortRecipes(recipes.filter((r) => matchesFilters(r, filters)), sort);
  const hasAny = recipes.length > 0;

  return (
    <div className="screen">
      <div className="top-row">
        <div className="h1">My Recipes</div>
        <Avatar user={user} onClick={openProfile} />
      </div>
      <div style={{ padding: '2px 20px 10px' }}>
        <input
          className="input"
          placeholder="Search recipes"
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
      {layout === 'grid' ? (
        <div
          className="scroll"
          style={{ padding: '2px 20px 100px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignContent: 'start' }}
        >
          {items.map((r) => (
            <RecipeGridCard key={r.id} recipe={r} onOpen={() => openRecipe(r)} />
          ))}
          {items.length === 0 && <EmptyState hasAny={hasAny} wide />}
        </div>
      ) : (
        <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((r) => (
            <RecipeRow key={r.id} recipe={r} onOpen={() => openRecipe(r)} />
          ))}
          {items.length === 0 && <EmptyState hasAny={hasAny} />}
        </div>
      )}
      <button className="fab" onClick={startAdd} aria-label="Add recipe">+</button>
    </div>
  );
}

function EmptyState({ hasAny, wide }) {
  return (
    <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 14, padding: '48px 20px', gridColumn: wide ? '1 / -1' : undefined, lineHeight: 1.6 }}>
      {hasAny ? 'No recipes match. Try another tag or add one with +.' : 'Your book is empty. Add your first recipe with +.'}
    </div>
  );
}
