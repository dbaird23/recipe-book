import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Avatar, Sheet, ChipToggle, Photo } from './components.jsx';
import AvatarCropper from './cropper.jsx';
import { MEALS, TAGS, RATING_FILTERS, metaOf } from './util.js';

export function ProfileSheet({ user, layout, setLayout, onClose, onSaved, onSignOut, onOpenKeys, toast }) {
  const [name, setName] = useState(user.name);
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState(null);
  const fileInput = useRef(null);

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      const { user: updated } = await api.updateMe(name.trim() || user.name);
      onSaved(updated);
      toast('Profile updated');
      onClose();
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function pickPhoto(file) {
    try {
      const { avatarUrl } = await api.uploadAvatar(file);
      onSaved({ ...user, avatarUrl });
      toast('Photo updated');
    } catch (e) {
      toast(e.message);
    }
  }

  if (cropFile) {
    return (
      <AvatarCropper
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onDone={async (cropped) => { setCropFile(null); await pickPhoto(cropped); }}
      />
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Your profile</div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginTop: 14 }}>
        <Avatar user={{ ...user, name }} size={76} fontSize={30} />
        <div style={{ display: 'flex', gap: 14 }}>
          <button className="btn-text-green" style={{ marginTop: 10, fontSize: 13 }} onClick={() => fileInput.current?.click()}>
            {user.avatarUrl ? 'Change photo' : 'Add a photo'}
          </button>
          {user.avatarUrl && (
            <button
              className="btn-text-green"
              style={{ marginTop: 10, fontSize: 13, color: 'var(--red)' }}
              onClick={async () => { await api.removeAvatar(); onSaved({ ...user, avatarUrl: null }); }}
            >
              Remove photo
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => { if (e.target.files[0]) setCropFile(e.target.files[0]); e.target.value = ''; }}
        />
      </div>
      <div className="section-label" style={{ fontSize: 11, margin: '14px 0 6px' }}>Name</div>
      <input className="input" style={{ padding: '12px 14px', fontWeight: 600 }} value={name} onChange={(e) => setName(e.target.value)} />
      <div className="section-label" style={{ fontSize: 11, margin: '14px 0 6px' }}>Recipe view</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <ChipToggle label="List" on={layout === 'list'} onToggle={() => setLayout('list')} />
        <ChipToggle label="Grid" on={layout === 'grid'} onToggle={() => setLayout('grid')} />
      </div>
      <div className="section-label" style={{ fontSize: 11, margin: '14px 0 6px' }}>Connected apps</div>
      <button className="btn-secondary" style={{ width: '100%' }} onClick={onOpenKeys}>Give an AI assistant access</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12.5, color: '#8a9686' }}>
        <span style={{ fontWeight: 700, color: '#4285f4' }}>G</span>
        Signed in · {user.email}
      </div>
      <button className="btn-primary" style={{ marginTop: 16 }} onClick={save} disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn-ghost" onClick={onClose}>Cancel</button>
        <button className="btn-ghost" style={{ color: 'var(--red)' }} onClick={onSignOut}>Sign out</button>
      </div>
    </Sheet>
  );
}

const CODE_BOX = {
  background: 'var(--card)',
  border: '1px solid var(--card-bd)',
  borderRadius: 12,
  padding: '11px 14px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: 'var(--muted)',
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
};

/**
 * API keys, for pointing an AI assistant at your recipes. The token is shown
 * once, at creation — after that only its first few characters are recoverable,
 * so the sheet leans on making that one moment easy to copy from.
 */
export function ApiKeysSheet({ onClose, toast }) {
  const [keys, setKeys] = useState(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null);

  useEffect(() => {
    api.apiKeys().then(({ keys }) => setKeys(keys)).catch((e) => { toast(e.message); setKeys([]); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${what} copied`);
    } catch {
      toast('Select the text above to copy it');
    }
  }

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await api.createApiKey(name.trim() || 'AI assistant');
      setCreated(result);
      setKeys((prev) => [result.key, ...(prev || [])]);
      setName('');
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(key) {
    if (!confirm(`Revoke “${key.name}”? Anything using it stops working immediately.`)) return;
    try {
      await api.revokeApiKey(key.id);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
      toast('Key revoked');
    } catch (e) {
      toast(e.message);
    }
  }

  if (created) {
    const config = JSON.stringify(
      { mcpServers: { 'recipe-book': { url: created.mcpUrl, headers: { Authorization: `Bearer ${created.token}` } } } },
      null,
      2
    );
    return (
      <Sheet onClose={onClose}>
        <div className="sheet-title">Here&rsquo;s the key</div>
        <div className="sheet-sub">Copy it now — for safety it isn&rsquo;t shown again.</div>
        <div style={{ ...CODE_BOX, marginTop: 14, color: 'var(--ink)' }}>{created.token}</div>
        <button className="btn-primary" style={{ marginTop: 10 }} onClick={() => copy(created.token, 'Key')}>
          Copy key
        </button>
        <div className="section-label" style={{ fontSize: 11, margin: '18px 0 6px' }}>For Cursor</div>
        <div className="sheet-sub" style={{ marginTop: 0 }}>
          Paste this into <code>~/.cursor/mcp.json</code>, then restart Cursor. Its AI gets tools for reading, adding and
          planning recipes.
        </div>
        <div style={{ ...CODE_BOX, marginTop: 10, maxHeight: 160, overflowY: 'auto' }}>{config}</div>
        <button className="btn-secondary" style={{ marginTop: 10, width: '100%' }} onClick={() => copy(config, 'Config')}>
          Copy config
        </button>
        <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setCreated(null)}>
          Done
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">AI &amp; API access</div>
      <div className="sheet-sub">
        A key lets a tool like Cursor read your recipes, add new ones and work on your meal plan. It can&rsquo;t delete
        recipes, invite people or change your account.
      </div>

      {keys?.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {keys.map((k) => (
            <div
              key={k.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, background: 'var(--card)',
                border: '1px solid var(--card-bd)', borderRadius: 12, padding: '10px 12px',
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{k.name}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>
                  {k.prefix}… · {k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}
                </div>
              </div>
              <button className="btn-text-green" style={{ fontSize: 13, color: 'var(--red)' }} onClick={() => revoke(k)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
      {keys?.length === 0 && (
        <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: '20px 0 4px' }}>
          No keys yet.
        </div>
      )}

      <div className="section-label" style={{ fontSize: 11, margin: '18px 0 6px' }}>New key</div>
      <input
        className="input"
        style={{ fontSize: 16, padding: '12px 14px' }}
        placeholder="What's it for? e.g. Cursor on my laptop"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button className="btn-primary" style={{ marginTop: 10 }} onClick={create} disabled={busy}>
        {busy ? 'Creating…' : 'Create key'}
      </button>
      <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Done</button>
    </Sheet>
  );
}

export function FilterSheet({ filters, setFilters, customTags = [], resultCount, onClose }) {
  const toggle = (key, t) =>
    setFilters({
      ...filters,
      [key]: filters[key].includes(t) ? filters[key].filter((x) => x !== t) : [...filters[key], t],
    });
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Filter recipes</div>
      <div className="sheet-sub">Pick any number of meals and tags.</div>
      <div className="section-label" style={{ fontSize: 11, margin: '16px 0 8px' }}>Rating</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {RATING_FILTERS.map((o) => (
          <ChipToggle
            key={String(o.value)}
            label={o.label}
            on={filters.rating === o.value}
            onToggle={() => setFilters({ ...filters, rating: filters.rating === o.value ? 0 : o.value })}
          />
        ))}
      </div>
      <div className="section-label" style={{ fontSize: 11, margin: '16px 0 8px' }}>Meal</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {MEALS.map((t) => (
          <ChipToggle key={t} label={t} on={filters.selMeals.includes(t)} onToggle={() => toggle('selMeals', t)} />
        ))}
      </div>
      <div className="section-label" style={{ fontSize: 11, margin: '16px 0 8px' }}>Tags</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[...TAGS, ...customTags].map((t) => (
          <ChipToggle key={t} label={t} on={filters.selTags.includes(t)} onToggle={() => toggle('selTags', t)} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button
          className="btn-secondary"
          style={{ flex: 1, color: 'var(--chip-fg)', fontSize: 14, padding: 12 }}
          onClick={() => setFilters({ ...filters, selMeals: [], selTags: [], rating: 0 })}
        >
          Clear all
        </button>
        <button className="btn-primary" style={{ flex: 2, width: 'auto', fontSize: 14, padding: 12 }} onClick={onClose}>
          Show {resultCount} {resultCount === 1 ? 'recipe' : 'recipes'}
        </button>
      </div>
    </Sheet>
  );
}

export function PlanPickerSheet({ dayName, recipes, onPickRecipe, onPickLeftovers, onPickText, onClose, toast }) {
  const [q, setQ] = useState('');
  const [free, setFree] = useState('');
  const query = q.trim().toLowerCase();
  const items = recipes.filter(
    (r) => !query || r.title.toLowerCase().includes(query) || r.tags.some((t) => t.toLowerCase().includes(query))
  );

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Plan {dayName} dinner</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <ChipToggle label="Leftovers" on={false} onToggle={onPickLeftovers} />
        <button
          className="chip on"
          onClick={() => {
            if (!recipes.length) return toast('Add a recipe first');
            onPickRecipe(recipes[Math.floor(Math.random() * recipes.length)], true);
          }}
        >
          Surprise me
        </button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <input
          className="input"
          value={free}
          onChange={(e) => setFree(e.target.value)}
          placeholder="Or type anything — 'Takeout', 'Date night'…"
          style={{ flex: 1, minWidth: 0, padding: '9px 12px' }}
        />
        <button
          className="btn-pill-solid"
          style={{ flex: '0 0 auto', padding: '9px 15px' }}
          onClick={() => (free.trim() ? onPickText(free.trim()) : toast('Type something first'))}
        >
          Add
        </button>
      </div>
      <input
        className="input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search your and friends' recipes"
        style={{ marginTop: 14, padding: '9px 12px' }}
      />
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, minHeight: 120 }}>
        {items.map((r) => (
          <button
            key={r.id}
            onClick={() => onPickRecipe(r)}
            style={{
              display: 'flex', gap: 10, alignItems: 'center', background: 'var(--card)', border: '1px solid var(--card-bd)',
              borderRadius: 12, padding: '9px 12px', cursor: 'pointer', textAlign: 'left',
            }}
          >
            <Photo
              photo={r.photos?.[0]}
              style={{ width: 36, height: 36, borderRadius: 8, flex: '0 0 auto', overflow: 'hidden' }}
              className={r.photos?.[0] ? '' : 'photo-ph'}
              label=""
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{r.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{r.ownerLabel} · {metaOf(r)}</div>
            </div>
          </button>
        ))}
        {items.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: 24 }}>No recipes match.</div>
        )}
      </div>
    </Sheet>
  );
}

export function GrocerySheet({ groups, checked, onToggle, onClose }) {
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Grocery list</div>
      <div className="sheet-sub">
        {groups.length === 0
          ? 'Built from your week’s plan'
          : `${total} items from ${groups.length} planned ${groups.length === 1 ? 'dinner' : 'dinners'}`}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14 }}>
        {groups.map((g) => (
          <div key={g.key}>
            <div className="section-label" style={{ fontSize: 11.5, marginBottom: 6 }}>{g.title}</div>
            <div className="card" style={{ padding: '2px 12px' }}>
              {g.items.map((item) => {
                const on = !!checked[item.key];
                return (
                  <div
                    key={item.key}
                    onClick={() => onToggle(item.key)}
                    style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '9px 0', borderBottom: '1px solid #f4f1ea', cursor: 'pointer' }}
                  >
                    <div
                      style={{
                        width: 18, height: 18, borderRadius: 5, flex: '0 0 auto', display: 'grid', placeItems: 'center',
                        border: `1.5px solid ${on ? 'var(--green)' : '#d8ccc4'}`, background: on ? 'var(--green)' : 'var(--card)',
                        color: '#fff', fontSize: 11,
                      }}
                    >
                      {on ? '✓' : ''}
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.4, color: on ? 'var(--faint)' : 'var(--ink)', textDecoration: on ? 'line-through' : 'none' }}>
                      {item.text}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--faint)', fontSize: 13, padding: 24 }}>
            Plan a dinner and its ingredients show up here.
          </div>
        )}
      </div>
    </Sheet>
  );
}

export function ShareSheet({ recipe, onClose, toast }) {
  const link = `${location.origin}${import.meta.env.BASE_URL}?r=${recipe.id}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Link copied');
    } catch {
      toast(link);
    }
    onClose();
  }
  async function nativeShare() {
    try {
      await navigator.share({ title: recipe.title, text: `${recipe.title} — from my Recipe Book`, url: link });
      onClose();
    } catch {
      /* user cancelled */
    }
  }
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Share this recipe</div>
      <div className="sheet-sub">
        Friends in your book already see your recipes — send a link to open this one directly.
      </div>
      <div
        style={{
          marginTop: 14, background: 'var(--card)', border: '1px solid var(--card-bd)', borderRadius: 12,
          padding: '11px 14px', fontSize: 13, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {link}
      </div>
      <button className="btn-primary" style={{ marginTop: 12 }} onClick={copy}>Copy link</button>
      {!!navigator.share && (
        <button className="btn-secondary" style={{ marginTop: 8, width: '100%' }} onClick={nativeShare}>
          Share…
        </button>
      )}
      <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
    </Sheet>
  );
}

export function InviteSheet({ onClose, toast }) {
  const [phone, setPhone] = useState('');
  const [invite, setInvite] = useState(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      setInvite(await api.createInvite(phone));
    } catch (e) {
      toast(e.message);
    } finally {
      setBusy(false);
    }
  }

  const smsBody = invite ? encodeURIComponent(`Join my Recipe Book! ${invite.url}`) : '';

  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Invite a friend</div>
      {invite ? (
        <>
          <div className="sheet-sub">Their private link to join your Recipe Book — it works once.</div>
          <div
            style={{
              marginTop: 14, background: 'var(--card)', border: '1px solid var(--card-bd)', borderRadius: 12,
              padding: '11px 14px', fontSize: 13, color: 'var(--muted)', wordBreak: 'break-all',
            }}
          >
            {invite.url}
          </div>
          <button
            className="btn-primary"
            style={{ marginTop: 12 }}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite.url);
                toast('Invite link copied');
              } catch {
                toast('Copy the link above');
              }
            }}
          >
            Copy link
          </button>
          <a
            className="btn-secondary"
            style={{ marginTop: 8, display: 'block', textAlign: 'center', textDecoration: 'none' }}
            href={`sms:${phone.replace(/[^+\d]/g, '')}?&body=${smsBody}`}
          >
            Text it
          </a>
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Done</button>
        </>
      ) : (
        <>
          <div className="sheet-sub">We&rsquo;ll make a private link you can text them to join your Recipe Book.</div>
          <input
            className="input"
            style={{ marginTop: 14, fontSize: 16, padding: '12px 14px' }}
            type="tel"
            placeholder="(555) 123-4567 · optional"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="btn-primary" style={{ marginTop: 12 }} onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create invite link'}
          </button>
          <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
        </>
      )}
    </Sheet>
  );
}

export function RemoveFriendSheet({ friend, onClose, onConfirm }) {
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-title">Remove {friend.name}?</div>
      <div className="sheet-sub" style={{ marginTop: 6, lineHeight: 1.55 }}>
        You won&rsquo;t see {friend.name}&rsquo;s recipes anymore, and they won&rsquo;t see yours. Recipes you already
        saved stay in your book. <strong style={{ color: 'var(--red)' }}>This can&rsquo;t be undone.</strong>
      </div>
      <button className="btn-danger" style={{ marginTop: 16 }} onClick={onConfirm}>
        Remove {friend.name}
      </button>
      <button className="btn-ghost" style={{ marginTop: 8 }} onClick={onClose}>Cancel</button>
    </Sheet>
  );
}
