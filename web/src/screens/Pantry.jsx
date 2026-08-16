import { useState } from 'react';
import { Check } from '../components.jsx';
import { PANTRY_LOCATIONS, pantryLine, qtyLabel } from '../util.js';

const ROW = {
  display: 'flex', gap: 10, alignItems: 'center',
  padding: '8px 0', borderBottom: '1px solid #f4f1ea',
};

const STEP_BTN = {
  width: 24, height: 24, border: '1px solid var(--input-bd)', background: 'var(--card)', color: '#665f58',
  borderRadius: 7, fontSize: 14, lineHeight: 1, cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center',
};

function Row({ item, inv, qty, editing, editDraft, setEditDraft, onStartEdit, onCommitEdit, onCancelEdit, onSetQty, onRemove }) {
  const have = qty > 0;
  const fg = !inv || have ? 'var(--ink)' : 'var(--faint)';

  if (editing) {
    return (
      <div style={ROW}>
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
    <div
      style={{ ...ROW, cursor: inv ? 'pointer' : 'default' }}
      onClick={inv ? () => onSetQty(have ? 0 : Math.max(1, qty)) : undefined}
    >
      {inv && <Check on={have} />}
      <div
        onClick={inv ? undefined : onStartEdit}
        style={{
          flex: 1, minWidth: 0, fontSize: 13.5, color: fg,
          textDecoration: inv && !have ? 'line-through' : 'none',
          cursor: inv ? 'pointer' : 'text',
        }}
      >
        {item.name}
      </div>

      {inv ? (
        <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={STEP_BTN} onClick={(e) => { e.stopPropagation(); onSetQty(Math.max(0, qty - 1)); }} aria-label={`Less ${item.name}`}>
            −
          </button>
          <div style={{ minWidth: 62, textAlign: 'center', fontSize: 12.5, fontWeight: 600, color: have ? 'var(--muted)' : 'var(--faint)' }}>
            {qtyLabel(qty, item.unit)}
          </div>
          <button style={STEP_BTN} onClick={(e) => { e.stopPropagation(); onSetQty(qty + 1); }} aria-label={`More ${item.name}`}>
            +
          </button>
        </div>
      ) : (
        <>
          <div style={{ flex: '0 0 auto', fontSize: 12.5, color: 'var(--muted)' }}>{qtyLabel(item.qty, item.unit)}</div>
          <button
            onClick={onRemove}
            aria-label={`Remove ${item.name}`}
            style={{ flex: '0 0 auto', border: 'none', background: 'none', color: '#c9c3be', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '2px 2px 4px' }}
          >
            ×
          </button>
        </>
      )}
    </div>
  );
}

/**
 * What's already in the kitchen, in three cards: pantry, fridge, freezer.
 *
 * Two modes. Day to day you add, rename and remove single items. "Take
 * inventory" is the walk down the shelves: every item gets a count you can
 * step up or down, and anything you zero out is gone when you save — which is
 * far less tapping than removing a dozen things one at a time. You can add
 * during that walk too, since half of taking stock is finding things you never
 * wrote down.
 */
export default function Pantry({ items, onAdd, onRename, onRemove, onSaveInventory }) {
  const [drafts, setDrafts] = useState({});
  const [editId, setEditId] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  const [inv, setInv] = useState(null); // { [id]: qty } while taking inventory, else null

  // An item added mid-inventory has no entry yet, so its own count stands in
  const qtyOf = (it) => (inv && inv[it.id] !== undefined ? inv[it.id] : it.qty);
  const kept = inv ? items.filter((it) => qtyOf(it) > 0).length : 0;
  const allKept = kept === items.length;

  function startInventory() {
    setEditId(null);
    setInv(Object.fromEntries(items.map((it) => [it.id, it.qty])));
  }

  function toggleAll() {
    setInv(Object.fromEntries(items.map((it) => [it.id, allKept ? 0 : qtyOf(it) || it.qty || 1])));
  }

  function saveInventory() {
    const changed = items.filter((it) => qtyOf(it) !== it.qty).map((it) => ({ id: it.id, qty: qtyOf(it) }));
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
      setInv((prev) => ({ ...prev, ...Object.fromEntries(added.map((it) => [it.id, it.qty])) }));
    }
  }

  function commitEdit(item) {
    const text = editDraft.trim();
    setEditId(null);
    if (text && text !== pantryLine(item)) onRename(item.id, text);
  }

  return (
    <div className="screen">
      <div className="top-row">
        <div className="h1">Pantry</div>
        {/* Available on an empty pantry too — taking stock of a bare shelf is
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
          ? 'Adjust counts with − / +. Zero means you’re out. Add anything you find.'
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
          return (
            <div key={loc.key} className="card" style={{ padding: '12px 14px 10px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <div className="section-label" style={{ fontSize: 11.5, letterSpacing: 0.8 }}>{loc.label}</div>
                <div style={{ fontSize: 12, color: 'var(--faint)' }}>
                  {shelf.length} {shelf.length === 1 ? 'item' : 'items'}
                </div>
              </div>

              {shelf.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  inv={!!inv}
                  qty={inv ? inv[item.id] ?? item.qty : item.qty}
                  editing={editId === item.id}
                  editDraft={editDraft}
                  setEditDraft={setEditDraft}
                  onStartEdit={() => { setEditId(item.id); setEditDraft(pantryLine(item)); }}
                  onCommitEdit={() => commitEdit(item)}
                  onCancelEdit={() => setEditId(null)}
                  onSetQty={(qty) => setInv((prev) => ({ ...prev, [item.id]: qty }))}
                  onRemove={() => onRemove(item)}
                />
              ))}

              {/* A textarea rather than an input so a dictated run of items
                  stays visible and correctable instead of scrolling out of
                  sight. It grows with the text; Enter still adds, since the
                  separators that matter come from speech as commas. */}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'flex-start' }}>
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
                  placeholder="2 cans black beans, rice, 3 onions"
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
