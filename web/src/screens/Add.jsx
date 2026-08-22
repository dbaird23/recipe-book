import { useRef, useState } from 'react';
import { api } from '../api.js';
import { ChipToggle } from '../components.jsx';
import { MEALS, TAGS, SAMPLE_PASTE, parseText } from '../util.js';

export function AddStep1({ onCancel, onDraft, toast }) {
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [pasteText, setPasteText] = useState('');

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
      onDraft({ ...draft, tags: [], photoUrls: draft.images || [] });
      toast('Recipe imported');
    } catch (e) {
      toast(e.message);
    } finally {
      setImporting(false);
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
            placeholder="https://a-recipe-page.com/…"
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runImport()}
          />
          <button className="btn-primary" style={{ flex: '0 0 auto', width: 'auto', padding: '11px 18px', fontSize: 14 }} onClick={runImport}>
            {importing ? 'Fetching…' : 'Import'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--faint)', marginTop: 6, lineHeight: 1.4 }}>
          Pulls in the photos, ingredients, directions, notes, nutrition, and the original creator.
        </div>
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
  const [files, setFiles] = useState([]);
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
          <textarea className="textarea" rows={6} placeholder={'2 lb chicken thighs\n4 cloves garlic…'} value={d.ing} onChange={set('ing')} />
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
            {[...standardTags, ...customTags].map((t) => (
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
        <button className="btn-primary" style={{ padding: 15, fontSize: 15.5, marginTop: 4 }} onClick={save} disabled={busy}>
          {busy ? 'Saving…' : 'Save recipe'}
        </button>
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
    </div>
  );
}
