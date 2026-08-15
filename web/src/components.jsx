import { avatarColor, metaOf } from './util.js';

export function Avatar({ user, size = 34, fontSize = 14, onClick }) {
  const Tag = onClick ? 'button' : 'div';
  const style = { width: size, height: size, fontSize, cursor: onClick ? 'pointer' : undefined };
  if (user?.avatarUrl) style.backgroundImage = `url(${user.avatarUrl})`;
  else style.background = avatarColor(user);
  return (
    <Tag className="avatar" style={style} onClick={onClick} aria-label={user?.name}>
      {user?.avatarUrl ? '' : (user?.name?.[0] || '?').toUpperCase()}
    </Tag>
  );
}

export function Photo({ photo, className = '', style, label = 'photo' }) {
  if (photo) {
    return (
      <div className={className} style={style}>
        <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      </div>
    );
  }
  return (
    <div className={`photo-ph ${className}`} style={style}>
      {label}
    </div>
  );
}

export function TagRow({ tags, max = 3 }) {
  if (!tags?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
      {tags.slice(0, max).map((t) => (
        <span key={t} className="tag">{t}</span>
      ))}
    </div>
  );
}

export function RecipeRow({ recipe, metaPrefix, onOpen }) {
  return (
    <button className="recipe-row" onClick={onOpen}>
      <Photo photo={recipe.photos?.[0]} className="thumb" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.25 }}>{recipe.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 2 }}>
          {metaPrefix ? `${metaPrefix} · ` : ''}{metaOf(recipe)}
        </div>
        <TagRow tags={recipe.tags} />
      </div>
      <div className="chev">›</div>
    </button>
  );
}

export function RecipeGridCard({ recipe, onOpen }) {
  return (
    <button
      className="recipe-row"
      onClick={onOpen}
      style={{ flexDirection: 'column', gap: 0, padding: 0, overflow: 'hidden', alignItems: 'stretch' }}
    >
      <Photo photo={recipe.photos?.[0]} style={{ height: 96 }} className={recipe.photos?.[0] ? '' : 'photo-ph'} />
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{recipe.title}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{metaOf(recipe)}</div>
      </div>
    </button>
  );
}

export function Sheet({ onClose, children }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ChipToggle({ label, on, onToggle }) {
  return (
    <button className={`chip${on ? ' on' : ''}`} onClick={onToggle}>
      {label}
    </button>
  );
}

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="4" y1="7" x2="20" y2="7" /><line x1="7" y1="12" x2="17" y2="12" /><line x1="10" y1="17" x2="14" y2="17" />
  </svg>
);

const SortIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M7 4 v14 M7 18 l-3 -3 M7 18 l3 -3" /><path d="M17 20 V6 M17 6 l-3 3 M17 6 l3 3" />
  </svg>
);

export function FilterSortBar({ filters, onOpenFilter, onClear, sort, onToggleSort }) {
  const n = filters.selMeals.length + filters.selTags.length;
  const active = n > 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 20px 12px', flex: '0 0 auto' }}>
      <button
        className={`chip${active ? ' on' : ''}`}
        style={{ display: 'flex', alignItems: 'center', gap: 7 }}
        onClick={onOpenFilter}
      >
        <FilterIcon />
        Filters{active ? ` · ${n}` : ''}
      </button>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: '#8a9686', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {[...filters.selMeals, ...filters.selTags].join(', ')}
      </div>
      {active && (
        <button className="btn-text-green" style={{ flex: '0 0 auto', fontSize: 12.5, padding: 4 }} onClick={onClear}>
          Clear
        </button>
      )}
      <button
        className="chip"
        style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, padding: '7px 13px' }}
        onClick={onToggleSort}
      >
        <SortIcon />
        {sort === 'alpha' ? 'A–Z' : 'Newest'}
      </button>
    </div>
  );
}

const BookIcon = ({ color }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 6 C10 4.5 7 4.5 4 5.5 V18.5 C7 17.5 10 17.5 12 19" />
    <path d="M12 6 C14 4.5 17 4.5 20 5.5 V18.5 C17 17.5 14 17.5 12 19" />
    <line x1="12" y1="6" x2="12" y2="19" />
  </svg>
);

const FriendsIcon = ({ color }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round">
    <circle cx="9" cy="9" r="3.2" /><path d="M3.5 19 c0 -3 2.5 -5 5.5 -5 s5.5 2 5.5 5" />
    <circle cx="16.5" cy="9.5" r="2.6" /><path d="M15.5 14.2 c3 0 5 1.8 5 4.8" />
  </svg>
);

export function TabBar({ screen, onHome, onFriends }) {
  const recipesFg = screen === 'home' ? 'var(--green)' : 'var(--label)';
  const friendsFg = screen === 'friends' ? 'var(--green)' : 'var(--label)';
  return (
    <div className="tabbar">
      <button onClick={onHome} style={{ color: recipesFg }}>
        <BookIcon color={recipesFg} />
        My Recipes
      </button>
      <button onClick={onFriends} style={{ color: friendsFg }}>
        <FriendsIcon color={friendsFg} />
        Friends
      </button>
    </div>
  );
}
