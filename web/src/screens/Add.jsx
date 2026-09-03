import { useRef, useState } from 'react';
import { api } from '../api.js';
import { ChipToggle } from '../components.jsx';
import { MEALS, TAGS, SAMPLE_PASTE, parseText, readableCopy } from '../util.js';

// The Worker takes no more than this in one scan, and the wording below says so.
const MAX_SCAN_PHOTOS = 4;

// Tags off an import land on the built-in chip when they only differ by case
// ("dinner" is Dinner), and stay as they were typed otherwise.
function matchTags(tags) {
  const standard = [...MEALS, ...TAGS];
  return [...new Set((tags || []).map((t) => standard.find((s) => s.toLowerCase() === t.toLowerCase()) || t))];
}

// Chips read fastest in alphabetical order, whichever list they came from
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });

export function AddStep1({ onCancel, onDraft, toast, canScan = false }) {
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [scanning, setScanning] = useState(false);
  const cameraInput = useRef(null);
  const photoInput = useRef(null);

  async function runImport() {
    const u = importUrl.trim();
    if (importing) return;
    if (!/^https?:\/\/|^www\.|\.\w{2,}/.test(u)) {
      toast('Paste a recipe link first');
      return;
    }
    setImporting(true);
    try {
      const { draft } = await api.importUrl(u);
      // A MealBoard share arrives with its categories; a web page has none
      onDraft({ ...draft, tags: matchTags(draft.tags), photoUrls: draft.images || [] });
      toast(draft.more ? `That link holds ${draft.more + 1} recipes. The first came through; share the rest one at a time for now.` : 'Recipe imported');
    } catch (e) {
      toast(e.message);
    } finally {
      setImporting(false);
    }
  }

  async function runScan(picked) {
    const photos = Array.from(picked).slice(0, MAX_SCAN_PHOTOS);
    if (!photos.length || scanning) return;
    setScanning(true);
    try {
      // Read from a copy sized for legibility; keep the originals for the book
      const { draft } = await api.scanPhotos(await Promise.all(photos.map(readableCopy)));
      onDraft({ ...draft, tags: [], photoUrls: [], photoFiles: photos });
      toast('Recipe read from your photo');
    } catch (e) {
      toast(e.message);
    } finally {
      setScanning(false);
    }
  }

  function parsePaste() {
    if (!pasteText.trim()) {
      toast('Paste a recipe first');
      return;
    }
    const { nut, ...r } = parseText(pasteText);
    // Carry parsed nutrition through as an override so it isn't re-estimated
    onDraft({ ...r, tags: [], source: null, photoUrls: [], nutImport: nut || undefined });
    toast(nut ? 'Recipe parsed, including nutrition' : 'Recipe parsed');
  }

  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn-link" onClick={onCancel}>Cancel</button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Add recipe</div>
        <div style={{ width: 56 }} />
      </div>
      {/* overflowY guards short screens: the app is clamped to one viewport,
          so without it this step would clip rather than scroll */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '8px 20px 24px', minHeight: 0, overflowY: 'auto' }}>
        <div className="section-label">From a link</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="input"
            style={{ flex: 1, minWidth: 0, padding: '11px 14px' }}
            placeholder="A recipe page, or a MealBoard share link"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runImport()}
          />
          <button className="btn-primary" style={{ flex: '0 0 auto', width: 'auto', padding: '11px 18px', fontSize: 14 }} onClick={runImport}>
            {importing ? 'Fetching…' : 'Import'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6, lineHeight: 1.4 }}>
          Pulls in the photos, ingredients, directions, notes, nutrition, and the original creator. A recipe
          shared out of MealBoard comes across too, categories and all.
        </div>

        {canScan && (
          <>
            <div className="divider-row">
              <div />
              <span>or photograph it</span>
              <div />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn-primary" style={{ flex: 1, width: 'auto', fontSize: 14.5 }} onClick={() => cameraInput.current?.click()} disabled={scanning}>
                {scanning ? 'Reading the photo…' : 'Take a photo'}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => photoInput.current?.click()} disabled={scanning}>
                Choose photos
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6, lineHeight: 1.4 }}>
              A cookbook page, a handwritten card, a clipping. Lay it flat and get the whole recipe in frame &mdash; up to{' '}
              {MAX_SCAN_PHOTOS} photos if it runs over the page.
            </div>
            {/* Two inputs, because a phone only offers the camera when the
                picker asks for it, and only offers the library when it doesn't */}
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { runScan(e.target.files); e.target.value = ''; }} />
            <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={(e) => { runScan(e.target.files); e.target.value = ''; }} />
          </>
        )}

        <div className="divider-row">
          <div />
          <span>or paste the text</span>
          <div />
        </div>
        <textarea
          className="textarea"
          style={{ flex: 1, marginTop: 12, borderRadius: 14, padding: 14, resize: 'none', lineHeight: 1.5 }}
          placeholder="Paste the whole recipe here…"
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
        />
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setPasteText(SAMPLE_PASTE)}>
            Try a sample
          </button>
          <button className="btn-primary" style={{ flex: 1, width: 'auto', fontSize: 14.5 }} onClick={parsePaste}>
            Continue
          </button>
        </div>
        <button
          className="btn-ghost"
          style={{ marginTop: 12, fontSize: 13 }}
          onClick={() => onDraft({ title: '', prep: '', cook: '', serv: '', ing: '', dirs: '', notes: '', tags: [], source: null, photoUrls: [] })}
        >
          or start from scratch
        </button>
      </div>
    </div>
  );
}

export function AddStep2({ draft: initial, editing, knownTags = [], onBack, onSave, onDelete }) {
  const [d, setD] = useState(initial);
  // A recipe scanned from a photo arrives with that photo already picked
  const [files, setFiles] = useState(initial.photoFiles || []);
  const [busy, setBusy] = useState(false);
  const [newTag, setNewTag] = useState('');
  const fileInput = useRef(null);
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });

  const standardTags = [...MEALS, ...TAGS];
  const customTags = [...new Set([...knownTags, ...d.tags.filter((t) => !standardTags.includes(t))])];

  function addNewTag() {
    const t = newTag.trim();
    if (!t) return;
    // Reuse an existing tag if it only differs by case
    const existing = [...standardTags, ...customTags].find((x) => x.toLowerCase() === t.toLowerCase());
    const tag = existing || t;
    if (!d.tags.includes(tag)) setD({ ...d, tags: [...d.tags, tag] });
    setNewTag('');
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await onSave(d, files);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen">
      <div className="back-row">
        <button className="btn-link" onClick={onBack}>‹ Back</button>
        <div style={{ fontSize: 16, fontWeight: 700 }}>{editing ? 'Edit recipe' : 'Review'}</div>
        <div style={{ width: 56 }} />
      </div>
      <div className="scroll" style={{ padding: '8px 20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {d.source && (
          <div style={{ background: 'var(--green-soft)', borderRadius: 12, padding: '10px 14px', fontSize: 13, color: '#4c5a4c', lineHeight: 1.45 }}>
            Imported from <strong>{d.source}</strong>. They&rsquo;ll be credited as the original creator.
          </div>
        )}
        {d.from && (
          <div
            style={{
              background: 'var(--green-soft)', borderRadius: 12, padding: '10px 14px', fontSize: 13,
              color: '#4c5a4c', lineHeight: 1.45, display: 'flex', alignItems: 'center', gap: 10,
            }}
          >
            <span style={{ flex: 1 }}>
              Originally added by <strong>{d.from}</strong>
            </span>
            <button
              className="btn-text-green"
              style={{ flex: '0 0 auto', color: 'var(--red)' }}
              onClick={() => setD({ ...d, from: null })}
            >
              Remove
            </button>
          </div>
        )}
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Title</div>
          <input className="input" style={{ fontWeight: 600 }} placeholder="Recipe name" value={d.title} onChange={set('title')} />
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[['prep', 'Prep min'], ['cook', 'Cook min'], ['serv', 'Servings']].map(([k, label]) => (
            <div key={k} style={{ flex: 1 }}>
              <div className="section-label" style={{ marginBottom: 6 }}>{label}</div>
              <input className="input" style={{ textAlign: 'center', padding: 11 }} inputMode="numeric" value={d[k]} onChange={set(k)} />
            </div>
          ))}
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Ingredients · one per line</div>
          <textarea
            className="textarea"
            rows={6}
            placeholder={'2 lb chicken thighs\n4 cloves garlic…\n\nFor the sauce:\n28 oz crushed tomatoes'}
            value={d.ing}
            onChange={set('ing')}
          />
          {/* Meatballs and the sauce they sit in are two lists, not one. A line
              ending in a colon says so, and it's how recipes already write it. */}
          <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6, lineHeight: 1.4 }}>
            Made of parts? End a line with a colon &mdash; <strong>For the sauce:</strong> &mdash; and everything under it
            becomes that section.
          </div>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Directions · one step per line</div>
          <textarea className="textarea" rows={6} placeholder="Preheat oven to 400°F…" value={d.dirs} onChange={set('dirs')} />
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Notes · one per line</div>
          <textarea
            className="textarea"
            rows={4}
            placeholder={'Make ahead: …\nFreezing: …'}
            value={d.notes}
            onChange={set('notes')}
          />
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 8 }}>Tags</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[...standardTags, ...customTags].sort(byName).map((t) => (
              <ChipToggle
                key={t}
                label={t}
                on={d.tags.includes(t)}
                onToggle={() => setD({ ...d, tags: d.tags.includes(t) ? d.tags.filter((x) => x !== t) : [...d.tags, t] })}
              />
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <input
              className="input"
              style={{ flex: 1, minWidth: 0, borderRadius: 999, padding: '6px 14px' }}
              placeholder="New tag, e.g. Taco night"
              value={newTag}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag(); } }}
            />
            <button className="chip" style={{ flex: '0 0 auto' }} onClick={addNewTag} disabled={!newTag.trim()}>
              + Add tag
            </button>
          </div>
        </div>
        <div>
          <div className="section-label" style={{ marginBottom: 6 }}>Photos</div>
          {(d.photoUrls?.length > 0 || files.length > 0) && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              {d.photoUrls?.map((u) => (
                <div key={u} style={{ position: 'relative' }}>
                  <img src={u} alt="" style={{ width: 90, height: 64, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={() => setD({ ...d, photoUrls: d.photoUrls.filter((x) => x !== u) })}
                    style={{ position: 'absolute', top: 2, right: 2, border: 'none', borderRadius: '50%', width: 20, height: 20, background: 'rgba(36,49,42,0.6)', color: '#fff', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
              {files.map((f, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img src={URL.createObjectURL(f)} alt="" style={{ width: 90, height: 64, borderRadius: 10, objectFit: 'cover', display: 'block' }} />
                  <button
                    onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    style={{ position: 'absolute', top: 2, right: 2, border: 'none', borderRadius: '50%', width: 20, height: 20, background: 'rgba(36,49,42,0.6)', color: '#fff', fontSize: 12, cursor: 'pointer', lineHeight: 1 }}
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => fileInput.current?.click()}
            style={{
              width: '100%', height: 90, border: '1.5px dashed #d0d6cb', borderRadius: 12, background: 'none',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: '#8a9686', cursor: 'pointer',
            }}
          >
            + Add photos
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => { setFiles([...files, ...Array.from(e.target.files)]); e.target.value = ''; }}
          />
        </div>
        {editing && (
          <button
            className="btn-ghost"
            style={{ color: 'var(--red)', fontSize: 13 }}
            onClick={() => { if (confirm('Delete this recipe? This can’t be undone.')) onDelete(); }}
          >
            Delete recipe
          </button>
        )}
      </div>
      {/* Saving stays where your thumb is. A recipe with two sets of
          ingredients is a long form, and the button was a scroll away from
          wherever you were typing. */}
      <div className="save-bar">
        <button className="btn-primary" style={{ padding: 15, fontSize: 15.5 }} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save recipe'}
        </button>
      </div>
    </div>
  );
}
