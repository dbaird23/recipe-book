import { useRef, useState } from 'react';
import { Avatar, Photo, Stars } from '../components.jsx';
import { autoNut, scaleIngredient, formatMinutes } from '../util.js';

function SectionLabel({ children, style }) {
  return <div className="section-label" style={{ margin: '22px 0 10px', ...style }}>{children}</div>;
}

export default function Recipe({
  recipe, user, isMine, savedAlready,
  goBack, onEdit, onShare, onSaveToMine,
  onUpdateNotes, onUpdateNut, onAddComment, onDeleteComment, onAddPhoto, onRemovePhoto, onRate,
}) {
  const [checked, setChecked] = useState({});
  const [mult, setMult] = useState(1);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [nutEditOpen, setNutEditOpen] = useState(false);
  const [nutDraft, setNutDraft] = useState(null);
  const [notesEditOpen, setNotesEditOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [commentText, setCommentText] = useState('');
  const [commentPhoto, setCommentPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const photoInput = useRef(null);
  const commentPhotoInput = useRef(null);

  const photos = recipe.photos || [];
  const hero = photos[Math.min(photoIdx, Math.max(photos.length - 1, 0))];
  const ownerLine = [
    recipe.source ? `By ${recipe.source}` : null,
    isMine ? (recipe.from ? `Saved from ${recipe.from}` : `Added by ${user.name}`) : `Added by ${recipe.ownerName}`,
  ].filter(Boolean).join(' · ');
  const nut = nutDraft || recipe.nut;

  async function postComment() {
    const text = commentText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onAddComment(text, commentPhoto);
      setCommentText('');
      setCommentPhoto(null);
    } finally {
      setBusy(false);
    }
  }

  function saveNut() {
    setNutEditOpen(false);
    if (nutDraft) {
      onUpdateNut({ cal: +nutDraft.cal || 0, pro: +nutDraft.pro || 0, carb: +nutDraft.carb || 0, fat: +nutDraft.fat || 0 }, true);
      setNutDraft(null);
    }
  }

  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn-link" onClick={goBack}>‹ Back</button>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {isMine ? (
            <>
              <button className="btn-pill-outline" onClick={onEdit}>Edit</button>
              <button className="btn-pill-solid" onClick={onShare}>Share</button>
            </>
          ) : savedAlready ? (
            <span style={{ color: 'var(--green)', fontSize: 13, fontWeight: 600, padding: '8px 6px' }}>✓ Saved</span>
          ) : (
            <button className="btn-pill-solid" onClick={onSaveToMine}>Save to my recipes</button>
          )}
        </div>
      </div>

      <div className="scroll" style={{ padding: '4px 20px 40px' }}>
        <Photo photo={hero} style={{ height: 186, borderRadius: 16, overflow: 'hidden' }} className={hero ? '' : 'photo-ph'} label={recipe.title} />

        {(photos.length > 1 || isMine) && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
            {photos.map((p, i) => (
              <div key={p.id} style={{ position: 'relative', flex: '0 0 auto' }}>
                <button
                  onClick={() => setPhotoIdx(i)}
                  style={{
                    width: 64, height: 48, borderRadius: 8, cursor: 'pointer', padding: 0, display: 'block',
                    overflow: 'hidden', border: `2px solid ${i === photoIdx ? 'var(--green)' : 'transparent'}`, background: 'none',
                  }}
                >
                  <img src={p.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
                {isMine && (
                  <button
                    aria-label="Remove this photo"
                    onClick={() => { onRemovePhoto(p.id); setPhotoIdx((idx) => Math.max(0, idx >= i ? idx - 1 : idx)); }}
                    style={{
                      position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 999,
                      border: '1.5px solid var(--card)', background: 'var(--red)', color: '#fff',
                      fontSize: 12, lineHeight: 1, cursor: 'pointer', padding: 0, display: 'grid', placeItems: 'center',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {isMine && (
              <>
                <button
                  onClick={() => photoInput.current?.click()}
                  style={{
                    width: 64, height: 48, borderRadius: 8, flex: '0 0 auto', cursor: 'pointer',
                    border: '1.5px dashed #d0d6cb', background: 'none', color: '#8a9686', fontSize: 12, fontWeight: 600,
                  }}
                >
                  +
                </button>
                <input
                  ref={photoInput}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => { onAddPhoto([...e.target.files]); e.target.value = ''; }}
                />
              </>
            )}
          </div>
        )}

        <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: -0.4, marginTop: 14, lineHeight: 1.2 }}>{recipe.title}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{ownerLine}</div>

        {/* You rate your own recipes; a friend's rating shows read-only */}
        {(isMine || recipe.rating > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 9 }}>
            <Stars value={recipe.rating || 0} size={19} gap={3} onRate={isMine ? onRate : undefined} />
            <span style={{ fontSize: 12.5, color: 'var(--faint)' }}>
              {recipe.rating > 0
                ? isMine
                  ? 'Your rating'
                  : `${recipe.ownerName}’s rating`
                : 'Rate this recipe'}
            </span>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {[['PREP', formatMinutes(recipe.prep)], ['COOK', formatMinutes(recipe.cook)], ['SERVES', recipe.servings * mult]].map(([k, v]) => (
            <div key={k} className="stat-card">
              <div style={{ fontSize: 11, color: 'var(--label)', fontWeight: 600 }}>{k}</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2, color: k === 'SERVES' && mult > 1 ? 'var(--green)' : undefined }}>
                {v}
              </div>
            </div>
          ))}
        </div>

        {recipe.tags.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
            {recipe.tags.map((t) => (
              <span key={t} className="tag" style={{ fontSize: 11.5, padding: '4px 10px' }}>{t}</span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 0 10px' }}>
          <SectionLabel style={{ margin: 0 }}>Ingredients</SectionLabel>
          <div style={{ display: 'flex', gap: 4 }}>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`chip${mult === n ? ' on' : ''}`}
                style={{ padding: '4px 10px', fontSize: 12 }}
                onClick={() => setMult(n)}
              >
                {n}×
              </button>
            ))}
          </div>
        </div>
        <div className="card" style={{ padding: '6px 14px' }}>
          {recipe.ing.map((txt, i) => {
            const on = !!checked[i];
            return (
              <div
                key={i}
                onClick={() => setChecked({ ...checked, [i]: !on })}
                style={{
                  display: 'flex', gap: 11, alignItems: 'center', padding: '10px 0',
                  borderBottom: '1px solid #f4f1ea', cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 20, height: 20, borderRadius: 6, flex: '0 0 auto',
                    border: `1.5px solid ${on ? 'var(--green)' : '#cfd5ca'}`,
                    background: on ? 'var(--green)' : '#fff', color: '#fff', fontSize: 12,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  {on ? '✓' : ''}
                </div>
                <div style={{ fontSize: 14.5, color: on ? 'var(--faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none', lineHeight: 1.4 }}>
                  {scaleIngredient(txt, mult)}
                </div>
              </div>
            );
          })}
        </div>

        <SectionLabel>Directions</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {recipe.dir.map((txt, i) => (
            <div key={i} style={{ display: 'flex', gap: 12 }}>
              <div
                style={{
                  width: 24, height: 24, borderRadius: '50%', background: 'var(--green-soft)', color: 'var(--green)',
                  fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
                }}
              >
                {i + 1}
              </div>
              <div style={{ fontSize: 14.5, lineHeight: 1.55, paddingTop: 2 }}>{txt}</div>
            </div>
          ))}
        </div>

        <SectionLabel style={{ margin: '24px 0 10px' }}>Notes</SectionLabel>
        {notesEditOpen ? (
          <div className="note-card" style={{ padding: 12 }}>
            <textarea
              className="textarea"
              style={{ border: 'none', background: 'none', padding: 0, resize: 'vertical', lineHeight: 1.55 }}
              rows={3}
              placeholder="Tweaks, brand swaps, what to try next time…"
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                className="btn-pill-solid"
                style={{ padding: '6px 14px', fontSize: 12.5 }}
                onClick={() => { setNotesEditOpen(false); onUpdateNotes(notesDraft.trim()); }}
              >
                Done
              </button>
            </div>
          </div>
        ) : recipe.notes ? (
          <div
            className="note-card"
            style={{ padding: '13px 14px', cursor: isMine ? 'pointer' : 'default' }}
            onClick={() => { if (isMine) { setNotesDraft(recipe.notes); setNotesEditOpen(true); } }}
          >
            <div style={{ fontSize: 14, lineHeight: 1.55, color: '#4c4a3c', whiteSpace: 'pre-wrap' }}>{recipe.notes}</div>
            {isMine && <div style={{ fontSize: 11.5, color: '#b0a884', marginTop: 6, fontWeight: 600 }}>Tap to edit</div>}
          </div>
        ) : isMine ? (
          <button
            className="note-card"
            style={{
              width: '100%', border: '1.5px dashed #ddd6bd', color: '#8a8468', padding: 13,
              fontSize: 13.5, fontWeight: 600, cursor: 'pointer', textAlign: 'left',
            }}
            onClick={() => { setNotesDraft(''); setNotesEditOpen(true); }}
          >
            + Add a note — tweaks, brand swaps, ideas for next time
          </button>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--faint)' }}>No notes on this one.</div>
        )}

        <SectionLabel style={{ margin: '24px 0 10px' }}>Nutrition · Per serving</SectionLabel>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span
              style={{
                fontSize: 11, fontWeight: 700, borderRadius: 999, padding: '3px 9px', letterSpacing: 0.5,
                color: recipe.nutEdited ? '#8a6d4f' : 'var(--green)',
                background: recipe.nutEdited ? '#f3ede4' : 'var(--green-soft)',
              }}
            >
              {recipe.nutEdited ? 'EXACT' : 'AUTO'}
            </span>
            {isMine && (
              <button className="btn-text-green" onClick={() => (nutEditOpen ? saveNut() : (setNutDraft({ ...recipe.nut }), setNutEditOpen(true)))}>
                {nutEditOpen ? 'Done' : 'Adjust'}
              </button>
            )}
          </div>
          {nutEditOpen ? (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['cal', 'calories'], ['pro', 'protein g'], ['carb', 'carbs g'], ['fat', 'fat g']].map(([k, label]) => (
                  <div key={k} style={{ flex: 1 }}>
                    <input
                      className="input"
                      style={{ padding: 8, textAlign: 'center', borderRadius: 8 }}
                      inputMode="numeric"
                      value={nut[k]}
                      onChange={(e) => setNutDraft({ ...nut, [k]: e.target.value.replace(/[^0-9]/g, '') })}
                    />
                    <div style={{ fontSize: 11, color: 'var(--label)', textAlign: 'center', marginTop: 3 }}>{label}</div>
                  </div>
                ))}
              </div>
              <button
                className="btn-text-green"
                style={{ marginTop: 10 }}
                onClick={() => { setNutEditOpen(false); setNutDraft(null); onUpdateNut(autoNut(recipe.ing.length), false); }}
              >
                Reset to auto
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8 }}>
                {[[recipe.nut.cal, 'calories'], [`${recipe.nut.pro}g`, 'protein'], [`${recipe.nut.carb}g`, 'carbs'], [`${recipe.nut.fat}g`, 'fat']].map(([v, label]) => (
                  <div key={label} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 700 }}>{v}</div>
                    <div style={{ fontSize: 11, color: 'var(--label)', marginTop: 1 }}>{label}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#b0b6aa', marginTop: 10, lineHeight: 1.4 }}>
                {recipe.nutEdited
                  ? 'From the recipe, not estimated.'
                  : 'Auto-calculated from ingredients. Add brands to your ingredients for exact numbers.'}
              </div>
            </>
          )}
        </div>

        <SectionLabel style={{ margin: '24px 0 10px' }}>Comments</SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recipe.comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10 }}>
              <Avatar user={c.author} size={30} fontSize={12} />
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>
                    {c.author.id === user.id ? 'You' : c.author.name}
                  </div>
                  {c.author.id === user.id && (
                    <button
                      className="btn-text-green"
                      style={{ color: 'var(--red)', fontSize: 11.5, padding: '2px 0' }}
                      onClick={() => { if (confirm('Delete this comment?')) onDeleteComment(c.id); }}
                    >
                      Delete
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5, marginTop: 2, color: '#3c463c' }}>{c.text}</div>
                {c.photoUrl && (
                  <img
                    src={c.photoUrl}
                    alt=""
                    style={{ marginTop: 8, width: 150, height: 100, borderRadius: 10, objectFit: 'cover', display: 'block' }}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 14, padding: 10 }}>
          <textarea
            className="textarea"
            style={{ border: 'none', background: 'none', padding: 0, resize: 'none' }}
            rows={2}
            placeholder="Add a comment — did you make it? change anything?"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
          />
          {commentPhoto && (
            <img
              src={URL.createObjectURL(commentPhoto)}
              alt=""
              style={{ margin: '4px 0 8px', width: 120, height: 80, borderRadius: 10, objectFit: 'cover', display: 'block' }}
            />
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              className="btn-text-green"
              onClick={() => (commentPhoto ? setCommentPhoto(null) : commentPhotoInput.current?.click())}
            >
              {commentPhoto ? 'Remove photo' : '+ Add a photo'}
            </button>
            <input
              ref={commentPhotoInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => { if (e.target.files[0]) setCommentPhoto(e.target.files[0]); e.target.value = ''; }}
            />
            <button className="btn-pill-solid" style={{ padding: '7px 16px' }} onClick={postComment} disabled={busy}>
              {busy ? 'Posting…' : 'Post'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
