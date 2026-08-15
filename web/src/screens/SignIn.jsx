import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

function GoogleButton({ clientId, onCredential }) {
  const ref = useRef(null);
  useEffect(() => {
    let cancelled = false;
    function render() {
      if (cancelled || !ref.current || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (resp) => onCredential(resp.credential),
      });
      window.google.accounts.id.renderButton(ref.current, {
        theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: 260,
      });
    }
    if (window.google?.accounts?.id) render();
    else {
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
    return () => { cancelled = true; };
  }, [clientId, onCredential]);
  return <div ref={ref} style={{ marginTop: 34, minHeight: 44 }} />;
}

export default function SignIn({ config, invite, inviteToken, onSignedIn, onError }) {
  const [devOpen, setDevOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function handle(fn) {
    if (busy) return;
    setBusy(true);
    try {
      const { user } = await fn();
      onSignedIn(user);
    } catch (e) {
      onError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center' }}>
      <div
        style={{
          width: 72, height: 72, borderRadius: 20, background: 'var(--green)', color: '#fdfcf9',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 700, marginBottom: 22,
        }}
      >
        RB
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>Recipe Book</div>
      <div style={{ fontSize: 15, color: 'var(--muted)', marginTop: 10, maxWidth: 250, lineHeight: 1.5 }}>
        Your private recipe book. No feeds, no strangers — just your recipes and your friends&rsquo;.
      </div>

      {config.demo && (
        <button
          className="btn-primary"
          style={{ marginTop: 34, width: 'auto', padding: '13px 32px' }}
          disabled={busy}
          onClick={() => handle(() => api.authDev('Anna', 'demo@recipebook'))}
        >
          {busy ? 'Opening…' : 'Try the demo'}
        </button>
      )}

      {config.googleEnabled && (
        <GoogleButton
          clientId={config.googleClientId}
          onCredential={(credential) => handle(() => api.authGoogle(credential, inviteToken))}
        />
      )}

      {config.devLoginEnabled && !config.demo && !devOpen && (
        <button
          className={config.googleEnabled ? 'btn-ghost' : 'btn-secondary'}
          style={{ marginTop: config.googleEnabled ? 12 : 34, width: 'auto', padding: '13px 24px' }}
          onClick={() => setDevOpen(true)}
        >
          {config.googleEnabled ? 'Dev sign in' : 'Sign in (dev mode)'}
        </button>
      )}

      {devOpen && (
        <form
          style={{ marginTop: 26, width: '100%', maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 10 }}
          onSubmit={(e) => {
            e.preventDefault();
            handle(() => api.authDev(name, email, inviteToken));
          }}
        >
          <input className="input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="input" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Continue'}
          </button>
          <div style={{ fontSize: 11.5, color: 'var(--faint)', lineHeight: 1.4 }}>
            Dev mode — no password. Add a Google client ID in .env for real sign-in.
          </div>
        </form>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: 'var(--faint)' }}>
        {config.demo
          ? 'Demo · everything runs and stays in this browser'
          : invite
            ? `Invite only · You were invited by ${invite.inviter}`
            : 'Invite only'}
      </div>
    </div>
  );
}
