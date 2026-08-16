import { useState } from 'react';
import { Photo } from '../components.jsx';
import { DAY_NAMES, MEAL_SLOTS, mondayOf, addDays, isoDate, shortDate, isToday, weekTitle, metaOf } from '../util.js';

const SLOT_ROW = {
  display: 'flex', gap: 10, alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f4f1ea',
};

// Wide enough for BREAKFAST, so all three meals line up in a column
const SLOT_LABEL = { flex: '0 0 auto', width: 78, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.7, color: 'var(--label)' };

/**
 * One meal on one day. Filled with a recipe it opens that recipe; filled with
 * leftovers or a typed plan it reopens the picker, so changing your mind is
 * one tap either way. The × clears just this meal.
 */
function Slot({ label, meal, onPick, onClear, onOpenRecipe }) {
  const recipe = meal?.recipe || null;
  const unavailable = meal?.type === 'recipe' && !recipe;

  return (
    <div style={SLOT_ROW}>
      <div style={SLOT_LABEL}>{label.toUpperCase()}</div>

      {!meal && (
        <button
          onClick={onPick}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', border: 'none', background: 'none', color: '#a08c80', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '3px 0' }}
        >
          + Add
        </button>
      )}

      {recipe && (
        <button
          onClick={() => onOpenRecipe(recipe.id)}
          style={{ flex: 1, minWidth: 0, display: 'flex', gap: 9, alignItems: 'center', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
        >
          <Photo
            photo={recipe.photoUrl ? { url: recipe.photoUrl } : null}
            style={{ width: 32, height: 32, borderRadius: 7, flex: '0 0 auto', overflow: 'hidden' }}
            className={recipe.photoUrl ? '' : 'photo-ph'}
            label=""
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {recipe.title}
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
              {(recipe.mine ? 'Yours' : recipe.ownerName) + ' · ' + metaOf(recipe)}
            </div>
          </div>
        </button>
      )}

      {meal && !recipe && (
        <button
          onClick={onPick}
          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
        >
          <span
            style={{
              fontSize: 12.5, fontWeight: 600, borderRadius: 999, padding: '4px 11px',
              color: unavailable ? 'var(--faint)' : 'var(--chip-fg)', background: '#f1efe7',
            }}
          >
            {unavailable ? 'Recipe unavailable' : meal.type === 'leftovers' ? 'Leftovers' : meal.text}
          </span>
        </button>
      )}

      {meal && (
        <button
          onClick={onClear}
          aria-label={`Clear ${label.toLowerCase()}`}
          style={{ flex: '0 0 auto', border: 'none', background: 'none', color: '#c9c3be', fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: '2px 2px 4px' }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function DayCard({ day, entry, onPick, onClearMeal, onClearDay, onOpenRecipe, onSaveNote }) {
  const [noteDraft, setNoteDraft] = useState(null); // null = not editing
  const note = entry?.note || '';
  const meals = entry?.meals || {};
  const anyPlanned = MEAL_SLOTS.some((s) => meals[s.key]);

  return (
    <div className="card" style={{ padding: '12px 14px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', paddingBottom: 6 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: isToday(day.date) ? 'var(--green)' : 'var(--ink)' }}>
            {day.name}
          </span>
          <span style={{ fontSize: 12, color: 'var(--faint)' }}>{shortDate(day.date)}</span>
        </div>
        {anyPlanned && (
          <button
            onClick={onClearDay}
            style={{ border: 'none', background: 'none', color: 'var(--faint)', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 2 }}
          >
            Clear day
          </button>
        )}
      </div>

      {MEAL_SLOTS.map((slot) => (
        <Slot
          key={slot.key}
          label={slot.label}
          meal={meals[slot.key]}
          onPick={() => onPick(slot)}
          onClear={() => onClearMeal(slot)}
          onOpenRecipe={onOpenRecipe}
        />
      ))}

      {noteDraft !== null ? (
        <div style={{ marginTop: 9, display: 'flex', gap: 8 }}>
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
            marginTop: 9, fontSize: 12.5, color: '#8a8468', background: 'var(--note-bg)',
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

export default function Plan({ weekOffset, setWeekOffset, entries, onPick, onClearMeal, onClearDay, onOpenRecipe, onSaveNote }) {
  const monday = mondayOf(weekOffset);
  const days = DAY_NAMES.map((name, i) => ({ name, date: addDays(monday, i) }));
  const byDate = Object.fromEntries(entries.map((e) => [e.date, e]));

  return (
    <div className="screen">
      <div style={{ padding: '16px 20px 4px' }}>
        <div className="h1">{weekTitle(weekOffset)}</div>
      </div>

      <div style={{ padding: '0 20px 10px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="week-nav" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week">‹</button>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', minWidth: 110, textAlign: 'center' }}>
          {shortDate(monday)} – {shortDate(addDays(monday, 6))}
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
            onPick={(slot) => onPick(day, slot)}
            onClearMeal={(slot) => onClearMeal(isoDate(day.date), slot)}
            onClearDay={() => onClearDay(isoDate(day.date))}
            onOpenRecipe={onOpenRecipe}
            onSaveNote={(note) => onSaveNote(isoDate(day.date), note)}
          />
        ))}
      </div>
    </div>
  );
}
