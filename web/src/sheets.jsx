import { useRef, useState } from 'react';
import { api } from './api.js';
import { Avatar, Sheet, ChipToggle } from './components.jsx';
import AvatarCropper from './cropper.jsx';
import { MEALS, TAGS, RATING_FILTERS } from './util.js';

export function ProfileSheet({ user, layout, setLayout, onClose, onSaved, onSignOut, toast }) {
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
