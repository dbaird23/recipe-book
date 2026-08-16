import { useState } from 'react';
import { Check } from '../components.jsx';
import { GROCERY_SECTIONS, mondayOf, addDays, shortDate, weekTitle } from '../util.js';

const ROW_BORDER = '1px solid #f4f1ea';

/**
 * One line to buy. An ingredient several of the week's dinners want is a single
 * line here, and it says so — tapping the count opens the recipes behind it so
 * you can see what you'd be short of if you skipped it.
 */
function ItemRow({ item, checked, onToggle, onOpenRecipe, onRemove }) {
  const [open, setOpen] = useState(false);
  const shared = item.sources.length > 1;
  const only = item.sources.length === 1 ? item.sources[0] : null;
  // The same recipe cooked twice in a week is two dinners, not two recipes
  const distinct = new Set(item.sources.map((s) => s.recipeId)).size;

  return (
    <div style={{ borderBottom: ROW_BORDER }}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', cursor: 'pointer' }}
      >
        <Check on={checked} style={{ marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 13.5, lineHeight: 1.4,
              color: checked ? 'var(--faint)' : 'var(--ink)',
              textDecoration: checked ? 'line-through' : 'none',
            }}
          >
            {item.label}
          </div>

          {shared && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                className="btn-text-green"
                style={{ fontSize: 11.5, padding: 0 }}
              >
                {distinct > 1 ? `For ${distinct} recipes` : `For ${item.sources.length} meals`} {open ? '⌃' : '⌄'}
              </button>
              {item.amounts.length > 0 && (
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{item.amounts.join(' + ')}</span>
              )}
            </div>
          )}

          {only && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenRecipe(only.recipeId); }}
              style={{ border: 'none', background: 'none', padding: '2px 0 0', fontSize: 11.5, color: 'var(--faint)', cursor: 'pointer' }}
            >
              {only.dayName.slice(0, 3)} {only.meal.toLowerCase()} · {only.title}
            </button>
          )}

          {item.manualId && (
            <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>Added by you</div>
          )}
        </div>

        {item.manualId && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(item); }}
            aria-label={`Remove ${item.label}`}
            style={{ flex: '0 0 auto', border: 'none', background: 'none', color: '#c9c3be', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '2px 2px 4px' }}
          >
            ×
          </button>
        )}
      </div>

      {shared && open && (
        <div style={{ margin: '0 0 9px 28px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {item.sources.map((s) => (
            <button
              key={`${s.date}-${s.meal}-${s.recipeId}`}
              onClick={() => onOpenRecipe(s.recipeId)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', cursor: 'pointer',
                background: 'var(--green-soft)', border: '1px solid var(--green-bd)', borderRadius: 9, padding: '6px 10px',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)', letterSpacing: 0.5 }}>
                {s.dayName.slice(0, 3).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink)' }}>
                {s.title} <span style={{ color: 'var(--faint)' }}>· {s.meal.toLowerCase()}</span>
              </span>
              <span className="chev" style={{ fontSize: 16, padding: 0 }}>›</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AddRow({ onAdd }) {
  const [text, setText] = useState('');
  const [section, setSection] = useState('');

  function submit() {
    const v = text.trim();
    if (!v) return;
    setText('');
    onAdd(v, section || null);
  }

  return (
    <div style={{ padding: '0 20px 12px', display: 'flex', gap: 8 }}>
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder="Add an item"
        style={{ flex: 1, minWidth: 0, padding: '9px 12px' }}
      />
      <select
        value={section}
        onChange={(e) => setSection(e.target.value)}
        aria-label="Aisle"
        style={{
          flex: '0 0 auto', maxWidth: 104, border: '1px solid var(--input-bd)', borderRadius: 12,
          background: 'var(--card)', color: 'var(--chip-fg)', fontSize: 13, fontWeight: 600, padding: '9px 6px',
        }}
      >
        <option value="">Aisle</option>
        {GROCERY_SECTIONS.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
      <button className="btn-pill-solid" style={{ flex: '0 0 auto', padding: '9px 15px' }} onClick={submit}>
        Add
      </button>
    </div>
  );
}

/**
 * The week's shopping, in aisle order rather than by day — one walk through the
 * shop instead of seven. Ticks live in the browser, so they survive a reload
 * but don't need a round trip while you're standing in an aisle.
 */
export default function Groceries({
  weekOffset, setWeekOffset, sections, skipped, total, checked, onToggle, onAdd, onRemove, onOpenRecipe,
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const monday = mondayOf(weekOffset);

  return (
    <div className="screen">
      <div className="top-row">
        <div className="h1">Groceries</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {total} {total === 1 ? 'item' : 'items'}
        </div>
      </div>

      <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="week-nav" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week">‹</button>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 110, textAlign: 'center' }}>
          {weekTitle(weekOffset)} · {shortDate(monday)} – {shortDate(addDays(monday, 6))}
        </div>
        <button className="week-nav" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week">›</button>
        {weekOffset !== 0 && (
          <button className="btn-text-green" onClick={() => setWeekOffset(0)}>This week</button>
        )}
      </div>

      <AddRow onAdd={onAdd} />

      <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {sections.map((s) => (
          <div key={s.key}>
            <div className="section-label" style={{ fontSize: 11.5, marginBottom: 6 }}>{s.label}</div>
            <div className="card" style={{ padding: '2px 12px' }}>
              {s.items.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  checked={!!checked[item.key]}
                  onToggle={() => onToggle(item.key)}
                  onOpenRecipe={onOpenRecipe}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        ))}

        {sections.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: 24, lineHeight: 1.6 }}>
            {skipped.length > 0
              ? 'Everything this week is already in your kitchen.'
              : 'Plan a dinner and its ingredients show up here — or add something yourself above.'}
          </div>
        )}

        {skipped.length > 0 && (
          <div>
            <button
              onClick={() => setShowSkipped((v) => !v)}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '2px 0', fontSize: 12.5, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
            >
              {showSkipped ? '⌃' : '⌄'}  {skipped.length} {skipped.length === 1 ? 'item' : 'items'} already in your kitchen
            </button>
            {showSkipped && (
              <div style={{ background: '#f7f5ef', border: '1px solid var(--card-bd)', borderRadius: 12, padding: '2px 12px', marginTop: 6 }}>
                {skipped.map((s) => (
                  <div key={s.text} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--card-bd)' }}>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--faint)', textDecoration: 'line-through' }}>
                      {s.text}
                    </div>
                    <div className="section-label" style={{ flex: '0 0 auto', fontSize: 11, letterSpacing: 0.5 }}>{s.location}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
