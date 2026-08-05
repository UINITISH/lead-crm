import { useState } from 'react';
import { login } from '../lib/api.js';

/**
 * Full-page property backdrop — a stylised modern glass-facade building
 * against a soft sky, rendered as SVG so there's no external image asset to
 * host or fetch. Purely decorative (aria-hidden).
 */
function PropertyBackground() {
  return (
    <svg
      className="login-bg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"
      xmlns="http://www.w3.org/2000/svg" aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#eef2f7" />
          <stop offset="55%" stopColor="#e4e9f0" />
          <stop offset="100%" stopColor="#c9d2dd" />
        </linearGradient>
        <linearGradient id="panelA" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f4f6f9" />
          <stop offset="100%" stopColor="#c3ccd9" />
        </linearGradient>
        <linearGradient id="panelB" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#dfe5ec" />
          <stop offset="100%" stopColor="#aab5c4" />
        </linearGradient>
        <linearGradient id="panelC" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c7d0dc" />
          <stop offset="100%" stopColor="#8b98ab" />
        </linearGradient>
      </defs>

      <rect x="0" y="0" width="1600" height="1000" fill="url(#sky)" />

      {/* Faceted glass tower, leaning across the right two-thirds of the frame */}
      <g opacity="0.94">
        <polygon points="760,1000 900,120 1120,60 1600,1000" fill="url(#panelA)" />
        <polygon points="1000,1000 1120,60 1310,140 1250,1000" fill="url(#panelB)" />
        <polygon points="1220,1000 1310,140 1470,230 1520,1000" fill="url(#panelC)" />
      </g>

      {/* Mullion grid — thin lines suggesting glass panes across the facade */}
      <g stroke="#ffffff" strokeOpacity="0.55" strokeWidth="2">
        {Array.from({ length: 16 }).map((_, i) => {
          const x = 800 + i * 52;
          return <line key={'v' + i} x1={x} y1={90 + i * 4} x2={x - 90} y2="1000" />;
        })}
        {Array.from({ length: 13 }).map((_, i) => {
          const y = 130 + i * 68;
          return <line key={'h' + i} x1={780 + i * 10} y1={y} x2={1550} y2={y - i * 6} />;
        })}
      </g>

      {/* Balcony bands — angled ledges catching the light, echoing the tower's lean */}
      <g fill="#ffffff" opacity="0.5">
        <polygon points="900,340 1560,340 1560,352 880,352" />
        <polygon points="870,520 1560,520 1560,534 850,534" />
        <polygon points="830,700 1560,700 1560,716 805,716" />
        <polygon points="785,880 1560,880 1560,898 758,898" />
      </g>

      {/* Soft ground shadow */}
      <rect x="0" y="960" width="1600" height="40" fill="#8b98ab" opacity="0.25" />
    </svg>
  );
}

/** Shown when there's no valid session — one login per client business. */
export default function LoginPage({ onSuccess }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email.trim(), password);
      onSuccess();
    } catch (e2) {
      setErr(e2.message);
    }
    setBusy(false);
  }

  return (
    <div className="login-page">
      <PropertyBackground />

      <div className="login-logo">
        <div className="login-logo-mark">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
            <path d="M3 21V9.5L12 3l9 6.5V21H14v-7h-4v7H3z" stroke="#1c2534" strokeWidth="1.7" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="login-logo-text">
          <div className="name">Core Value Realty</div>
          <div className="tag">CRM</div>
        </div>
      </div>

      <div className="login-card-zone">
        <form onSubmit={submit} className="login-card">
          <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 23, fontWeight: 700 }}>Sign in</h1>
          <p className="muted" style={{ marginTop: 0, marginBottom: 24, fontSize: 13 }}>
            Please enter your business account details.
          </p>

          {err && <div className="form-error" style={{ marginBottom: 14 }}>{err}</div>}

          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   autoComplete="username" required autoFocus placeholder="you@business.com" />
          </div>
          <div className="field" style={{ marginBottom: 6 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   autoComplete="current-password" required placeholder="••••••••" />
          </div>

          <button type="submit" disabled={busy || !email.trim() || !password}
                  style={{
                    width: '100%', marginTop: 18, padding: '11px 0', fontSize: 14, fontWeight: 600,
                    background: '#1c2534', borderColor: '#1c2534', color: '#fff', borderRadius: 8,
                  }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>

          <p className="muted" style={{ marginTop: 18, marginBottom: 0, fontSize: 12, textAlign: 'center' }}>
            Trouble signing in? Contact whoever set up your account.
          </p>
        </form>
      </div>
    </div>
  );
}
