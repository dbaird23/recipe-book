import { useRef, useState } from 'react';
import { Check } from '../components.jsx';
import { DAY_NAMES } from '../util.js';

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
    // Dragging across a line you're editing is selecting words, not swiping the
    // row out of the way
    if (e.target.closest('input')) return;
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
        // A swipe shouldn't also open the line for editing
        onClickCapture={(e) => { if (dx) { e.stopPropagation(); setDx(0); } }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One line to buy. A line put here from the plan remembers the meals that asked
 * for it, and says so: tapping the count opens the recipes behind it so you can
 * see what you'd be short of if you skipped it. Swiping it left removes it.
 *
 * The tick and the words do different jobs. Ticking it off takes it off the
 * list, so only the box does that; tapping the words opens them for editing,
 * because a line you reach for mid-shop is usually one you want to reword
 * ("2 lb chicken thighs, boneless" is a recipe's wording, not a shopping list's).
 */
function ItemRow({ item, onToggle, onOpenRecipe, onRemove, onRename }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null); // null = not editing
  const settled = useRef(false);
  const shared = item.sources.length > 1;
  const only = item.sources.length === 1 ? item.sources[0] : null;
  // The same recipe cooked twice in a week is two meals, not two recipes
  const distinct = new Set(item.sources.map((s) => s.recipeId)).size;
  const dayOf = (src) => DAY_NAMES[(new Date(`${src.date}T12:00:00`).getDay() + 6) % 7] || '';

  // Return, Escape and tapping away all land here, and the first one through
  // wins: Return closes the input, which fires a blur behind it, and an edit
  // shouldn't be saved twice. Blanking a line keeps the old words rather than
  // leaving a row with nothing written on it; the swipe is how you delete.
  function finish(text, keep) {
    if (settled.current) return;
    settled.current = true;
    setDraft(null);
    const v = (text || '').trim();
    if (!keep || !v || v === item.label) return;
    onRename(item, v);
  }

  return (
    <SwipeRow onDelete={() => onRemove(item)} deleteLabel={`Delete ${item.label}`}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '9px 0' }}>
        {/* Padded out to a thumb's worth of target while the tick stays small */}
        <button
          onClick={onToggle}
          aria-label={`Tick off ${item.label}`}
          style={{ flex: '0 0 auto', border: 'none', background: 'none', cursor: 'pointer', padding: '2px 8px 8px 2px', margin: '-2px -8px -8px -2px' }}
        >
          <Check on={false} style={{ marginTop: 1 }} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          {draft !== null ? (
            <input
              className="input"
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => finish(e.target.value, true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') finish(e.currentTarget.value, true);
                if (e.key === 'Escape') finish('', false);
              }}
              style={{ width: '100%', fontSize: 13.5, padding: '4px 8px' }}
            />
          ) : (
            <div
              onClick={() => { settled.current = false; setDraft(item.label); }}
              style={{ fontSize: 13.5, lineHeight: 1.4, color: 'var(--ink)', cursor: 'text' }}
            >
              {item.label}
            </div>
          )}

          {shared && (
            <div style={{ display: 'flex', gap: 7, alignItems: 'baseline', flexWrap: 'wrap', marginTop: 2 }}>
              <button
                onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
                className="btn-text-green"
                style={{ fontSize: 11.5, padding: 0 }}
              >
                {distinct > 1 ? `For ${distinct} recipes` : `For ${item.sources.length} meals`} {open ? '⌃' : '⌄'}
              </button>
            </div>
          )}

          {only && (
            <button
              onClick={(e) => { e.stopPropagation(); onOpenRecipe(only.recipeId); }}
              style={{ border: 'none', background: 'none', padding: '2px 0 0', fontSize: 11.5, color: 'var(--faint)', cursor: 'pointer' }}
            >
              {dayOf(only).slice(0, 3)} {only.meal} · {only.title}
            </button>
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
                {dayOf(s).slice(0, 3).toUpperCase()}
              </span>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: 'var(--ink)' }}>
                {s.title} <span style={{ color: 'var(--faint)' }}>· {s.meal}</span>
              </span>
              <span className="chev" style={{ fontSize: 16, padding: 0 }}>›</span>
            </button>
          ))}
        </div>
      )}
    </SwipeRow>
  );
}

/**
 * Just the words. The aisle is read off them: "batteries" is household and
 * "sourdough" is bakery without being asked, and anything unrecognised lands in
 * Other, which is a shorter walk than picking from a list of nine every time.
 * A line filed somewhere odd can be reworded in place, and it moves.
 */
function AddRow({ onAdd }) {
  const [text, setText] = useState('');

  function submit() {
    const v = text.trim();
    if (!v) return;
    setText('');
    onAdd(v, null);
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
      <button className="btn-pill-solid" style={{ flex: '0 0 auto', padding: '9px 15px' }} onClick={submit}>
        Add
      </button>
    </div>
  );
}

/**
 * The shopping, in aisle order rather than by day, so it's one walk through the
 * shop. One list, not a week's: what the plan calls for is put on it from the
 * plan when the planning is done, and it stays until it's bought or removed.
 * Ticks live in the browser, so they survive a reload but don't need a round
 * trip while you're standing in an aisle.
 *
 * Ticking something off takes it off the list rather than greying it out, because what
 * you want in front of you in a shop is what you still have to find. The ones
 * you've got are folded away at the bottom, a tap from coming back, and any
 * aisle you don't walk down folds away too.
 */
export default function Groceries({
  sections, total, checked, onToggle, onAdd, onRemove, onRename, onOpenRecipe, onFinishShop,
}) {
  const [showDone, setShowDone] = useState(false);
  // Which aisles are folded away: a standing preference, since the aisle you
  // never walk down is the same aisle every week.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('rb-grocery-collapsed') || '{}');
    } catch {
      return {};
    }
  });

  function toggleAisle(key) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('rb-grocery-collapsed', JSON.stringify(next));
      return next;
    });
  }

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

      <AddRow onAdd={onAdd} />

      <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {left.map((s) => {
          const shut = !!collapsed[s.key];
          return (
            <div key={s.key}>
              <button
                onClick={() => toggleAisle(s.key)}
                aria-expanded={!shut}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  border: 'none', background: 'none', padding: 0, marginBottom: shut ? 0 : 6, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: 'var(--faint)', fontSize: 11, lineHeight: 1 }}>{shut ? '▸' : '▾'}</span>
                  <span className="section-label" style={{ fontSize: 11.5 }}>{s.label}</span>
                </div>
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                  {s.items.length} {s.items.length === 1 ? 'item' : 'items'}
                </span>
              </button>
              {/* No side padding: the rows carry it, so a swiped-open Delete
                  reaches the edge of the card rather than stopping short */}
              {!shut && (
                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                  {s.items.map((item) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      onToggle={() => onToggle(item.key)}
                      onOpenRecipe={onOpenRecipe}
                      onRemove={onRemove}
                      onRename={onRename}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {left.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: 24, lineHeight: 1.6 }}>
            {done.length > 0
              ? 'That’s everything. The whole list is in the trolley.'
              : 'Nothing to buy. Add something above, or put a week’s ingredients on the list from the plan.'}
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
                    style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: ROW_BORDER }}
                  >
                    <button
                      onClick={() => onToggle(item.key)}
                      aria-label={`Put ${item.label} back on the list`}
                      style={{ flex: '0 0 auto', border: 'none', background: 'none', cursor: 'pointer', padding: '6px 8px 6px 2px', margin: '-6px -8px -6px -2px' }}
                    >
                      <Check on />
                    </button>
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: 'var(--faint)', textDecoration: 'line-through' }}>
                      {item.label}
                    </div>
                  </div>
                ))}
                {/* The end of a trip: what's in the trolley has been bought, so
                    it comes off the list for good. Everything still on the list
                    stays, since it's what you didn't find. */}
                <button
                  className="btn-text-green"
                  style={{ width: '100%', padding: '10px 0 9px', fontSize: 13 }}
                  onClick={onFinishShop}
                >
                  Start a new shop · clears {done.length}
                </button>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
