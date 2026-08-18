import { useRef, useState } from 'react';
import { Check } from '../components.jsx';
import { GROCERY_SECTIONS, mondayOf, addDays, shortDate, weekTitle } from '../util.js';

const ROW_BORDER = '1px solid #f4f1ea';

const DELETE_W = 84;

/**
 * A row you can swipe left to delete. The button sits underneath and is
 * uncovered by the drag rather than sliding in, so a half-swipe reads as "not
 * yet" instead of "nearly". Dragging is suppressed once the gesture looks
 * vertical, so the list still scrolls normally under a thumb.
 */
function SwipeRow({ onDelete, deleteLabel, children }) {
  const [dx, setDx] = useState(0);
  const drag = useRef(null);

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, from: dx, axis: null };
  }

  function move(e) {
    const d = drag.current;
    if (!d) return;
    const dxNow = e.clientX - d.x;
    if (!d.axis) {
      if (Math.abs(dxNow) < 6 && Math.abs(e.clientY - d.y) < 6) return;
      d.axis = Math.abs(dxNow) > Math.abs(e.clientY - d.y) ? 'x' : 'y';
      if (d.axis === 'x') e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (d.axis !== 'x') return;
    setDx(Math.max(-DELETE_W, Math.min(0, d.from + dxNow)));
  }

  function up() {
    const d = drag.current;
    drag.current = null;
    if (d?.axis === 'x') setDx((v) => (v < -DELETE_W / 2 ? -DELETE_W : 0));
  }

  return (
    <div style={{ position: 'relative', borderBottom: ROW_BORDER, overflow: 'hidden' }}>
      <button
        onClick={onDelete}
        aria-label={deleteLabel}
        tabIndex={dx ? 0 : -1}
        style={{
          position: 'absolute', inset: '0 0 0 auto', width: DELETE_W, border: 'none', background: 'var(--red)',
          color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        }}
      >
        Delete
      </button>
      <div
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        // Let the browser own vertical scrolling; we only ever take over the x axis
        style={{
          position: 'relative', background: 'var(--card)', touchAction: 'pan-y', padding: '0 12px',
          transform: `translateX(${dx}px)`, transition: drag.current ? 'none' : 'transform .18s ease',
        }}
        // A swipe shouldn't also tick the item off
        onClickCapture={(e) => { if (dx) { e.stopPropagation(); setDx(0); } }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One line to buy. An ingredient several of the week's meals want is a single
 * line here, and it says so — tapping the count opens the recipes behind it so
 * you can see what you'd be short of if you skipped it. Ticking it off takes it
 * off the list; swiping it left removes it altogether.
 */
function ItemRow({ item, onToggle, onOpenRecipe, onRemove }) {
  const [open, setOpen] = useState(false);
  const shared = item.sources.length > 1;
  const only = item.sources.length === 1 ? item.sources[0] : null;
  // The same recipe cooked twice in a week is two meals, not two recipes
  const distinct = new Set(item.sources.map((s) => s.recipeId)).size;

  return (
    <SwipeRow onDelete={() => onRemove(item)} deleteLabel={`Delete ${item.label}`}>
      <div
        onClick={onToggle}
        style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0', cursor: 'pointer' }}
      >
        <Check on={false} style={{ marginTop: 1 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ink)' }}>{item.label}</div>

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
    </SwipeRow>
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
 *
 * Ticking something off takes it off the list rather than greying it out — what
 * you want in front of you in a shop is what you still have to find. The ones
 * you've got are folded away at the bottom, a tap from coming back.
 */
export default function Groceries({
  weekOffset, setWeekOffset, sections, skipped, removed, total, checked, onToggle, onAdd, onRemove, onRestore, onOpenRecipe,
}) {
  const [showSkipped, setShowSkipped] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const monday = mondayOf(weekOffset);

  const left = sections
    .map((s) => ({ ...s, items: s.items.filter((it) => !checked[it.key]) }))
    .filter((s) => s.items.length);
  const done = sections.flatMap((s) => s.items.filter((it) => checked[it.key]));

  return (
    <div className="screen">
      <div className="top-row">
        <div className="h1">Groceries</div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
          {done.length ? `${total - done.length} of ${total} left` : `${total} ${total === 1 ? 'item' : 'items'}`}
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
        {left.map((s) => (
          <div key={s.key}>
            <div className="section-label" style={{ fontSize: 11.5, marginBottom: 6 }}>{s.label}</div>
            {/* No side padding: the rows carry it, so a swiped-open Delete
                reaches the edge of the card rather than stopping short */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {s.items.map((item) => (
                <ItemRow
                  key={item.key}
                  item={item}
                  onToggle={() => onToggle(item.key)}
                  onOpenRecipe={onOpenRecipe}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </div>
        ))}

        {left.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: 24, lineHeight: 1.6 }}>
            {done.length > 0
              ? 'That’s everything — the whole list is in the trolley.'
              : skipped.length > 0
                ? 'Everything this week is already in your kitchen.'
                : 'Plan a meal and its ingredients show up here — or add something yourself above.'}
          </div>
        )}

        {done.length > 0 && (
          <div>
            <button
              onClick={() => setShowDone((v) => !v)}
              style={{ width: '100%', textAlign: 'left', border: 'none', background: 'none', padding: '2px 0', fontSize: 12.5, fontWeight: 600, color: 'var(--label)', cursor: 'pointer' }}
            >
              {showDone ? '⌃' : '⌄'}  {done.length} in the trolley
            </button>
            {showDone && (
              <div className="card" style={{ padding: '2px 12px', marginTop: 6 }}>
                {done.map((item) => (
                  <div
                    key={item.key}
                    onClick={() => onToggle(item.key)}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: ROW_BORDER, cursor: 'pointer' }}
                  >
                    <Check on />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--faint)', textDecoration: 'line-through' }}>
                      {item.label}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {removed.length > 0 && (
          <div>
            <div className="section-label" style={{ fontSize: 11.5, marginBottom: 6 }}>
              Struck off this week
            </div>
            <div className="card" style={{ padding: '2px 12px' }}>
              {removed.map((r) => (
                <div
                  key={r.key}
                  style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: ROW_BORDER }}
                >
                  <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: 'var(--faint)', textDecoration: 'line-through' }}>
                    {r.label}
                  </div>
                  <button className="btn-text-green" style={{ flex: '0 0 auto' }} onClick={() => onRestore(r.key)}>
                    Put back
                  </button>
                </div>
              ))}
            </div>
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
