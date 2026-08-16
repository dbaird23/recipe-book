import { useState } from 'react';
import { Photo } from '../components.jsx';
import { DAY_NAMES, mondayOf, addDays, isoDate, shortDate, isToday, weekTitle, metaOf } from '../util.js';

const GroceryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 5 h2 l2.2 11 h10.5 l2 -8 H7" /><circle cx="10" cy="20" r="1.4" /><circle cx="17" cy="20" r="1.4" />
  </svg>
);

function DayCard({ day, entry, onPick, onClear, onOpenRecipe, onSaveNote }) {
  const [noteDraft, setNoteDraft] = useState(null); // null = not editing
  const note = entry?.note || '';
  const recipe = entry?.recipe || null;
  const unavailable = entry?.type === 'recipe' && !recipe;

  return (
    <div className="card" style={{ padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: isToday(day.date) ? 'var(--green)' : 'var(--ink)' }}>
            {day.name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>{shortDate(day.date)}</span>
        </div>
        {entry?.type && (
          <button
            onClick={onClear}
            style={{ border: 'none', background: 'none', color: 'var(--faint)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}
          >
            Clear
          </button>
        )}
      </div>

      {recipe && (
        <button
          onClick={() => onOpenRecipe(recipe.id)}
          style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 9, cursor: 'pointer', background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left' }}
        >
          <Photo
            photo={recipe.photoUrl ? { url: recipe.photoUrl } : null}
            style={{ width: 40, height: 40, borderRadius: 8, flex: '0 0 auto', overflow: 'hidden' }}
            className={recipe.photoUrl ? '' : 'photo-ph'}
            label=""
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.25 }}>{recipe.title}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
              {(recipe.mine ? 'Yours' : recipe.ownerName) + ' · ' + metaOf(recipe)}
            </div>
          </div>
          <div className="chev" style={{ fontSize: 18 }}>›</div>
        </button>
      )}

      {unavailable && (
        <div style={{ marginTop: 9, fontSize: 13, color: 'var(--faint)' }}>
          That recipe isn’t available any more.
        </div>
      )}

      {entry?.type && entry.type !== 'recipe' && (
        <div style={{ marginTop: 9 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--chip-fg)', background: '#f1efe7', borderRadius: 999, padding: '5px 12px' }}>
            {entry.type === 'leftovers' ? 'Leftovers' : entry.text}
          </span>
        </div>
      )}

      {!entry?.type && (
        <button
          onClick={onPick}
          style={{
            width: '100%', marginTop: 9, border: '1.5px dashed #ddd6cb', background: 'none', color: '#a08c80',
            borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
          }}
        >
          + Plan dinner
        </button>
      )}

      {noteDraft !== null ? (
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <input
            className="input"
            autoFocus
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Note for this day…"
            style={{ flex: 1, minWidth: 0, background: 'var(--note-bg)', borderColor: 'var(--note-bd)', padding: '7px 10px' }}
          />
          <button
            onClick={() => { onSaveNote(noteDraft); setNoteDraft(null); }}
            className="btn-pill-solid"
            style={{ flex: '0 0 auto' }}
          >
            Done
          </button>
        </div>
      ) : note ? (
        <div
          onClick={() => setNoteDraft(note)}
          style={{
            marginTop: 8, fontSize: 12.5, color: '#8a8468', background: 'var(--note-bg)',
            border: '1px solid var(--note-bd)', borderRadius: 8, padding: '6px 10px', cursor: 'pointer',
          }}
        >
          {note}
        </div>
      ) : (
        <button
          onClick={() => setNoteDraft('')}
          style={{ marginTop: 8, border: 'none', background: 'none', color: '#c2bb9c', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}
        >
          + Note
        </button>
      )}
    </div>
  );
}

export default function Plan({ weekOffset, setWeekOffset, entries, onPick, onClear, onOpenRecipe, onSaveNote, onOpenGrocery }) {
  const monday = mondayOf(weekOffset);
  const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(monday, i) }));
  const byDate = Object.fromEntries(entries.map((e) => [e.date, e]));

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="h1">{weekTitle(weekOffset)}</div>
        <button className="btn-pill-outline" style={{ display: 'flex', alignItems: 'center', gap: 7 }} onClick={onOpenGrocery}>
          <GroceryIcon />
          Grocery list
        </button>
      </div>

      <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="week-nav" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week">‹</button>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 110, textAlign: 'center' }}>
          {shortDate(monday)} – {shortDate(addDays(monday, 6))} · Dinners
        </div>
        <button className="week-nav" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week">›</button>
        {weekOffset !== 0 && (
          <button className="btn-text-green" onClick={() => setWeekOffset(0)}>This week</button>
        )}
      </div>

      <div className="scroll" style={{ padding: '2px 20px 100px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {days.map((day) => (
          <DayCard
            key={isoDate(day.date)}
            day={day}
            entry={byDate[isoDate(day.date)]}
            onPick={() => onPick(day)}
            onClear={() => onClear(isoDate(day.date))}
            onOpenRecipe={onOpenRecipe}
            onSaveNote={(note) => onSaveNote(isoDate(day.date), note)}
          />
        ))}
      </div>
    </div>
  );
}
