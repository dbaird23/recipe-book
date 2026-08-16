import { avatarColor, metaOf, ratingFilterLabel, SORT_LABELS } from './util.js';

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

const StarShape = ({ filled, size, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}
    fill={filled ? color : 'none'} stroke={color} strokeWidth="1.6" strokeLinejoin="round">
    <path d="M12 3 l2.85 5.8 6.4 .93 -4.63 4.5 1.09 6.37 L12 17.6 l-5.71 3 1.09 -6.37 L2.75 9.73 l6.4 -.93 z" />
  </svg>
);

/**
 * Star rating. Read-only by default; pass onRate to let the owner set it.
 * Tapping the current rating again clears it.
 */
export function Stars({ value = 0, size = 14, gap = 2, onRate, dim = false }) {
  const color = value ? 'var(--star)' : 'var(--faint)';
  return (
    <div style={{ display: 'inline-flex', gap, alignItems: 'center', opacity: dim ? 0.75 : 1 }}>
      {[1, 2, 3, 4, 5].map((n) =>
        onRate ? (
          <button
            key={n}
            onClick={(e) => { e.stopPropagation(); onRate(n === value ? 0 : n); }}
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
            style={{ background: 'none', border: 0, padding: 2, margin: -2, cursor: 'pointer', lineHeight: 0 }}
          >
            <StarShape filled={n <= value} size={size} color={n <= value ? 'var(--star)' : 'var(--faint)'} />
          </button>
        ) : (
          <StarShape key={n} filled={n <= value} size={size} color={color} />
        )
      )}
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 2, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {metaPrefix ? `${metaPrefix} · ` : ''}{metaOf(recipe)}
          </span>
          {recipe.rating > 0 && <Stars value={recipe.rating} size={11.5} />}
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
        {recipe.rating > 0 && <div style={{ marginTop: 5 }}><Stars value={recipe.rating} size={11.5} /></div>}
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

/** The tick box used down the pantry shelves. */
export function Check({ on, style }) {
  return (
    <div
      style={{
        width: 18, height: 18, borderRadius: 5, flex: '0 0 auto', display: 'grid', placeItems: 'center',
        border: `1.5px solid ${on ? 'var(--green)' : '#d8ccc4'}`, background: on ? 'var(--green)' : 'var(--card)',
        color: '#fff', fontSize: 11, ...style,
      }}
    >
      {on ? '✓' : ''}
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
  const ratingLabel = ratingFilterLabel(filters.rating);
  const n = filters.selMeals.length + filters.selTags.length + (ratingLabel ? 1 : 0);
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
        {[...filters.selMeals, ...filters.selTags, ...(ratingLabel ? [ratingLabel] : [])].join(', ')}
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
        {SORT_LABELS[sort]}
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

const PlanIcon = ({ color }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="5" width="16" height="16" rx="3" /><line x1="4" y1="10" x2="20" y2="10" />
    <line x1="9" y1="3" x2="9" y2="7" /><line x1="15" y1="3" x2="15" y2="7" />
  </svg>
);

const PantryIcon = ({ color }) => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5.5" y="2.5" width="13" height="19" rx="2.5" /><line x1="12" y1="2.5" x2="12" y2="21.5" />
    <line x1="10" y1="9" x2="10" y2="12.5" /><line x1="14" y1="9" x2="14" y2="12.5" />
  </svg>
);

export function TabBar({ screen, onHome, onPlan, onPantry, onFriends }) {
  const fg = (s) => (screen === s ? 'var(--green)' : 'var(--label)');
  return (
    <div className="tabbar">
      <button onClick={onHome} style={{ color: fg('home') }}>
        <BookIcon color={fg('home')} />
        My Recipes
      </button>
      <button onClick={onPlan} style={{ color: fg('plan') }}>
        <PlanIcon color={fg('plan')} />
        Plan
      </button>
      <button onClick={onPantry} style={{ color: fg('pantry') }}>
        <PantryIcon color={fg('pantry')} />
        Pantry
      </button>
      <button onClick={onFriends} style={{ color: fg('friends') }}>
        <FriendsIcon color={fg('friends')} />
        Friends
      </button>
    </div>
  );
}
