import { useState } from 'react';
import { Check } from '../components.jsx';
import { PANTRY_LOCATIONS, pantryLine, qtyLabel } from '../util.js';

// The divider sits on top of each row: the add box is above the list now, so
// this separates the first item from it and leaves no dangling line under the
// last one.
const ROW = {
  display: 'flex', gap: 10, alignItems: 'center',
  padding: '8px 0', borderTop: '1px solid #f4f1ea',
};

const STEP_BTN = {
  width: 24, height: 24, border: '1px solid var(--input-bd)', background: 'var(--card)', color: '#665f58',
  borderRadius: 7, fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center',
};

function Row({ item, inv, qty, out, editing, editDraft, setEditDraft, onStartEdit, onCommitEdit, onCancelEdit, onSetQty, onToggleOut, onRemove }) {
  if (editing) {
    return (
      <div style={ROW}>
        {/* The box stays put while you type, so rewording something halfway
            down the shelves doesn't lose your place in the walk */}
        {inv && (
          <button
            onClick={onToggleOut}
            aria-pressed={!out}
            aria-label={out ? `${item.name}, out` : `${item.name}, in stock`}
            onMouseDown={(e) => e.preventDefault()}
            style={{ flex: '0 0 auto', display: 'flex', border: 'none', background: 'none', cursor: 'pointer', padding: 7, margin: -7 }}
          >
            <Check on={!out} />
          </button>
        )}
        <input
          className="input"
          autoFocus
          value={editDraft}
          onChange={(e) => setEditDraft(e.target.value)}
          onBlur={onCommitEdit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitEdit();
            if (e.key === 'Escape') onCancelEdit();
          }}
          style={{ flex: 1, minWidth: 0, padding: '5px 8px' }}
        />
        {/* Keep focus on the input so the click lands before the blur does */}
        <button
          className="btn-pill-solid"
          style={{ flex: '0 0 auto', borderRadius: 8, padding: '6px 12px', fontSize: 12.5 }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCommitEdit}
        >
          Save
        </button>
      </div>
    );
  }

  return (
    <div style={ROW}>
      {/* Only the box crosses an item out. The padding buys a thumb-sized
          target without moving anything. */}
      {inv && (
        <button
          onClick={onToggleOut}
          aria-pressed={!out}
          aria-label={out ? `${item.name}, out` : `${item.name}, in stock`}
          style={{ flex: '0 0 auto', display: 'flex', border: 'none', background: 'none', cursor: 'pointer', padding: 7, margin: -7 }}
        >
          <Check on={!out} />
        </button>
      )}
      {/* Tapping the words rewords the item, taking stock or not: half of a walk
          down the shelves is finding that what you wrote down says the wrong
          thing. Only the box crosses an item out, so the two never collide. */}
      <div
        onClick={onStartEdit}
        style={{
          flex: 1, minWidth: 0, fontSize: 13.5, color: out ? 'var(--faint)' : 'var(--ink)',
          textDecoration: out ? 'line-through' : 'none',
          cursor: 'text',
        }}
      >
        {item.name}
      </div>

      {/* The steppers are here whether or not you're taking inventory: using
          one jar of something is far more common than a walk down the shelves.
          Day to day they stop at one; an item you're out of goes with ×. */}
      <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          style={{ ...STEP_BTN, opacity: !inv && qty <= 1 ? 0.4 : 1 }}
          disabled={!inv && qty <= 1}
          onClick={(e) => { e.stopPropagation(); onSetQty(Math.max(inv ? 0 : 1, qty - 1)); }}
          aria-label={`Less ${item.name}`}
        >
          −
        </button>
        <div style={{ minWidth: 62, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: out || qty === 0 ? 'var(--faint)' : 'var(--muted)' }}>
          {qtyLabel(qty, item.unit)}
        </div>
        <button style={STEP_BTN} onClick={(e) => { e.stopPropagation(); onSetQty(qty + 1); }} aria-label={`More ${item.name}`}>
          +
        </button>
      </div>

      {!inv && (
        <button
          onClick={onRemove}
          aria-label={`Remove ${item.name}`}
          style={{ flex: '0 0 auto', border: 'none', background: 'none', color: '#c9c3be', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '2px 2px 4px' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * What's already in the kitchen, in three cards: pantry, fridge, freezer. Any
 * of them folds away, since most kitchens have one shelf that's twice the size
 * of the other two.
 *
 * Two modes. Day to day you add, rename, count up and down, and remove single
 * items. "Take inventory" is the walk down the shelves: untick the box beside
 * anything that's gone (only the box, and the count stays put, so a mis-tap
 * costs nothing) and everything still unticked when you save is removed. You
 * can add and reword during that walk too, since half of taking stock is
 * finding things you never wrote down and things you wrote down wrong.
 */
export default function Pantry({ items, onAdd, onRename, onRemove, onSetQty, onSaveInventory }) {
  const [drafts, setDrafts] = useState({});
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [inv, setInv] = useState(null); // { qty: {id: n}, out: {id: true} } while taking inventory
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('rb-pantry-collapsed') || '{}');
    } catch {
      return {};
    }
  });

  // An item added mid-inventory has no entry yet, so its own count stands in
  const qtyOf = (it) => (inv && inv.qty[it.id] !== undefined ? inv.qty[it.id] : it.qty);
  const isOut = (it) => !!inv?.out[it.id];
  const kept = inv ? items.filter((it) => !isOut(it)).length : 0;
  const allKept = kept === items.length;

  function toggleCollapsed(key) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('rb-pantry-collapsed', JSON.stringify(next));
      return next;
    });
  }

  function startInventory() {
    setEditId(null);
    setInv({ qty: Object.fromEntries(items.map((it) => [it.id, it.qty])), out: {} });
  }

  function toggleAll() {
    setInv((prev) => ({ ...prev, out: allKept ? Object.fromEntries(items.map((it) => [it.id, true])) : {} }));
  }

  function saveInventory() {
    // A crossed-out item is sent as a zero, which is how the API hears "gone"
    const changed = items
      .filter((it) => isOut(it) || qtyOf(it) !== it.qty)
      .map((it) => ({ id: it.id, qty: isOut(it) ? 0 : qtyOf(it) }));
    setInv(null);
    onSaveInventory(changed);
  }

  async function add(location) {
    const text = (drafts[location] || '').trim();
    if (!text) return;
    setDrafts((d) => ({ ...d, [location]: '' }));
    const added = await onAdd(location, text);
    // Count what just arrived as present, so saving doesn't read it as a zero
    if (inv && added?.length) {
      setInv((prev) => ({ ...prev, qty: { ...prev.qty, ...Object.fromEntries(added.map((it) => [it.id, it.qty])) } }));
    }
  }

  // What the row is actually showing, which during a walk is that walk's count
  // rather than the stored one: stepping something to 5 and then rewording it
  // shouldn't put it back to the 2 on file.
  const lineOf = (item) => pantryLine(inv ? { ...item, qty: qtyOf(item) } : item);

  async function commitEdit(item) {
    const text = editDraft.trim();
    setEditId(null);
    if (!text || text === lineOf(item)) return;
    const saved = await onRename(item.id, text);
    // A rename can carry a new count ("beans" becomes "3 cans beans"). The walk
    // writes its own counts when it's saved, so this one has to move with it or
    // saving would quietly undo the rename.
    if (saved) {
      setInv((prev) => (prev ? { ...prev, qty: { ...prev.qty, [item.id]: saved.qty } } : prev));
    }
  }

  return (
    <div className="screen">
      <div className="top-row">
        <div className="h1">Pantry</div>
        {/* Available on an empty pantry too, since taking stock of a bare shelf is
            how you fill it, now that the walk can add as well as subtract */}
        {(!inv || items.length > 0) && (
          <button
            className="btn-pill-outline"
            style={{ whiteSpace: 'nowrap', ...(inv ? { background: 'var(--green-soft)' } : null) }}
            onClick={() => (inv ? toggleAll() : startInventory())}
          >
            {inv ? (allKept ? 'Uncheck all' : 'Check all') : 'Take inventory'}
          </button>
        )}
      </div>

      <div style={{ padding: '0 20px 10px', fontSize: 12.5, color: 'var(--muted)' }}>
        {inv
          ? 'Untick the box beside anything you’re out of. Counts stay as they are unless you change them with − / +.'
          : items.length === 0
            ? 'Add what you keep on hand and the grocery list will stop asking for it.'
            : `${items.length} ${items.length === 1 ? 'item' : 'items'} on hand · skipped when building your grocery list`}
      </div>

      <div
        className="scroll"
        style={{ padding: `2px 20px ${inv ? 170 : 110}px`, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {PANTRY_LOCATIONS.map((loc) => {
          const shelf = items.filter((it) => it.location === loc.key);
          const shut = !!collapsed[loc.key];
          return (
            <div key={loc.key} className="card" style={{ padding: shut ? '12px 14px' : '12px 14px 10px' }}>
              <button
                onClick={() => toggleCollapsed(loc.key)}
                aria-expanded={!shut}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ color: 'var(--faint)', fontSize: 11, lineHeight: 1 }}>{shut ? '▸' : '▾'}</span>
                  <span className="section-label" style={{ fontSize: 11.5, letterSpacing: 0.8 }}>{loc.label}</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>
                  {shelf.length} {shelf.length === 1 ? 'item' : 'items'}
                </div>
              </button>

              {!shut && (
                <>
                  {/* The add box leads the shelf: filling the kitchen is what
                      you come here to do, and on a long shelf the box was a
                      scroll away. A textarea rather than an input so a dictated
                      run of items stays visible and correctable instead of
                      scrolling out of sight. It grows with the text; Enter
                      still adds, since the separators that matter come from
                      speech as commas. */}
                  <div style={{ display: 'flex', gap: 8, margin: '10px 0 2px', alignItems: 'flex-start' }}>
                    <textarea
                      className="input"
                      rows={1}
                      value={drafts[loc.key] || ''}
                      onChange={(e) => setDrafts((d) => ({ ...d, [loc.key]: e.target.value }))}
                      onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px`; }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          e.target.style.height = 'auto';
                          add(loc.key);
                        }
                      }}
                      placeholder="2 cans beans, spaghetti 2 bags"
                      style={{
                        flex: 1, minWidth: 0, background: '#faf8f3', borderRadius: 8, padding: '7px 10px',
                        resize: 'none', overflow: 'hidden', lineHeight: 1.4, fontFamily: 'inherit',
                      }}
                    />
                    <button
                      className="btn-pill-solid"
                      style={{ flex: '0 0 auto', borderRadius: 8, padding: '7px 14px', fontSize: 12.5 }}
                      onClick={() => add(loc.key)}
                    >
                      Add
                    </button>
                  </div>

                  {shelf.map((item) => (
                    <Row
                      key={item.id}
                      item={item}
                      inv={!!inv}
                      qty={qtyOf(item)}
                      out={isOut(item)}
                      editing={editId === item.id}
                      editDraft={editDraft}
                      setEditDraft={setEditDraft}
                      onStartEdit={() => { setEditId(item.id); setEditDraft(lineOf(item)); }}
                      onCommitEdit={() => commitEdit(item)}
                      onCancelEdit={() => setEditId(null)}
                      onSetQty={(qty) =>
                        inv
                          ? setInv((prev) => ({ ...prev, qty: { ...prev.qty, [item.id]: qty } }))
                          : onSetQty(item, qty)
                      }
                      onToggleOut={() =>
                        setInv((prev) => {
                          const out = { ...prev.out };
                          if (out[item.id]) delete out[item.id];
                          else out[item.id] = true;
                          return { ...prev, out };
                        })
                      }
                      onRemove={() => onRemove(item)}
                    />
                  ))}

                </>
              )}
            </div>
          );
        })}
      </div>

      {inv && (
        <div className="action-bar">
          <button
            className="btn-secondary"
            style={{ flex: '0 0 auto', color: 'var(--chip-fg)', borderColor: 'var(--input-bd)', padding: '12px 18px', fontSize: 14 }}
            onClick={() => setInv(null)}
          >
            Cancel
          </button>
          <button className="btn-primary" style={{ flex: 1, width: 'auto', fontSize: 14, padding: 12 }} onClick={saveInventory}>
            Save · keeping {kept} of {items.length}
          </button>
        </div>
      )}
    </div>
  );
}
