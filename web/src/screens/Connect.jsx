import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Avatar } from '../components.jsx';

/**
 * The consent screen: where an outside app's request to read this book gets
 * answered. ChatGPT sends the browser to /oauth/authorize, the Worker checks
 * the request and parks it, and the browser lands here with its id.
 *
 * It lives in the app rather than being rendered by the Worker so that signing
 * in is the sign-in the app already has. If nobody is signed in, App shows the
 * usual SignIn screen first and we pick up afterwards, which also means the
 * account being connected is always whoever is actually at the keyboard.
 */
export default function Connect({ user, rq, onSignOut }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .oauthPending(rq)
      .then(({ request: r }) => setRequest(r))
      .catch((e) => setError(e.message));
  }, [rq]);

  async function answer(allow) {
    if (busy) return;
    setBusy(true);
    try {
      const { redirectTo } = await api.oauthConsent(rq, allow);
      // Back to whoever asked. replace() so the back button doesn't re-answer
      // a request that has already been spent.
      location.replace(redirectTo);
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const asking = request?.clientName || 'An app';

  return (
    // Scrolls, unlike the sign-in screen it sits behind: there's more to read
    // here than fits a short phone, and .app clips what it can't show. The
    // inner `margin: auto 0` centres it when there is room without cutting the
    // top off when there isn't, which is what justify-content would do.
    <div className="screen scroll" style={{ alignItems: 'center', padding: 28, textAlign: 'center' }}>
      <div style={{ margin: 'auto 0', display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%' }}>
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width={76} height={76} style={{ borderRadius: 18 }} />

        {error && (
          <>
            <div className="sheet-title" style={{ marginTop: 22 }}>
              That didn&rsquo;t work
            </div>
            <div className="sheet-sub" style={{ maxWidth: 300 }}>
              {error}
            </div>
          </>
        )}

        {!error && !request && <div style={{ marginTop: 24, color: 'var(--faint)', fontSize: 14 }}>Loading&hellip;</div>}

        {!error && request && (
          <>
            <div className="sheet-title" style={{ marginTop: 22 }}>
              Connect {asking}?
            </div>
            <div className="sheet-sub" style={{ maxWidth: 320 }}>
              {asking} is asking to work with your recipes on Pinch.
            </div>

            {/* Whose book, spelled out. The whole risk of a consent screen is
              saying yes on the wrong account, and a household shares a laptop. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginTop: 18,
                padding: '10px 14px',
                border: '1px solid var(--line)',
                borderRadius: 999,
              }}
            >
              <Avatar user={user} size={28} fontSize={12} />
              <div style={{ textAlign: 'left', lineHeight: 1.25 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{user.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--faint)' }}>{user.email}</div>
              </div>
            </div>

            <div
              style={{
                marginTop: 20,
                padding: '14px 16px',
                border: '1px solid var(--line)',
                borderRadius: 14,
                textAlign: 'left',
                fontSize: 13,
                lineHeight: 1.55,
                maxWidth: 340,
              }}
            >
              <div style={{ fontWeight: 600, marginBottom: 6 }}>It will be able to</div>
              <div style={{ color: 'var(--faint)' }}>
                Read your recipes and your friends&rsquo;, add and edit your own, and work on your pantry, meal plan and
                grocery list.
              </div>
              <div style={{ fontWeight: 600, margin: '12px 0 6px' }}>It won&rsquo;t be able to</div>
              <div style={{ color: 'var(--faint)' }}>
                Delete recipes or photos, invite anyone, change your account, or see anything belonging to people outside
                your book.
              </div>
            </div>

            <button
              className="btn-primary"
              style={{ marginTop: 20, minWidth: 240 }}
              disabled={busy}
              onClick={() => answer(true)}
            >
              {busy ? 'Connecting…' : `Allow ${asking}`}
            </button>
            <button
              className="btn-secondary"
              style={{ marginTop: 10, minWidth: 240 }}
              disabled={busy}
              onClick={() => answer(false)}
            >
              Not now
            </button>

            <div style={{ marginTop: 18, fontSize: 11.5, color: 'var(--faint)', maxWidth: 320 }}>
              You can disconnect it later from your profile, under Connected apps.
            </div>
            <button className="btn-ghost" style={{ marginTop: 6, fontSize: 12 }} onClick={onSignOut}>
              Not {user.name}? Sign out
            </button>
          </>
        )}
      </div>
    </div>
  );
}
