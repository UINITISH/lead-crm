import { useState } from 'react';
import { login } from '../lib/api.js';

/** City-skyline silhouette, purely decorative — sets a property/real-estate
    tone without depending on any external image asset. */
function SkylineBackground() {
  return (
    <svg viewBox="0 0 900 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <radialGradient id="glow" cx="72%" cy="18%" r="55%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c1f45" stopOpacity="0" />
          <stop offset="100%" stopColor="#0c1f45" stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="900" height="700" fill="url(#glow)" />
      <circle cx="650" cy="120" r="70" fill="#ffffff" opacity="0.06" />

      {/* Back row — shorter, dimmer buildings */}
      <g fill="#ffffff" opacity="0.10">
        <rect x="0" y="430" width="70" height="270" />
        <rect x="90" y="380" width="55" height="320" />
        <rect x="165" y="460" width="90" height="240" />
        <rect x="275" y="400" width="65" height="300" />
        <rect x="360" y="440" width="80" height="260" />
        <rect x="460" y="390" width="60" height="310" />
        <rect x="540" y="430" width="95" height="270" />
        <rect x="650" y="360" width="70" height="340" />
        <rect x="735" y="410" width="60" height="290" />
        <rect x="810" y="450" width="90" height="250" />
      </g>

      {/* Front row — taller, brighter, with lit windows */}
      <g fill="#ffffff" opacity="0.22">
        <rect x="20" y="500" width="80" height="200" />
        <rect x="120" y="440" width="60" height="260" />
        <rect x="200" y="520" width="100" height="180" rx="2" />
        <rect x="320" y="380" width="70" height="320" />
        <rect x="410" y="470" width="85" height="230" />
        <rect x="515" y="410" width="65" height="290" />
        <rect x="600" y="500" width="110" height="200" />
        <rect x="730" y="450" width="75" height="250" />
        <rect x="825" y="510" width="75" height="190" />
      </g>

      {/* Windows */}
      <g fill="#ffd479" opacity="0.55">
        {[
          [30, 520], [30, 550], [30, 580], [30, 610], [55, 520], [55, 550], [55, 580],
          [135, 460], [135, 490], [135, 520], [135, 550], [155, 460], [155, 490], [155, 550],
          [330, 400], [330, 430], [330, 460], [355, 400], [355, 460], [355, 490],
          [425, 500], [425, 530], [450, 500], [450, 560],
          [530, 440], [530, 470], [530, 500], [550, 440], [550, 500],
          [615, 530], [615, 560], [615, 590], [645, 530], [645, 590], [670, 530], [670, 560],
          [745, 480], [745, 510], [745, 540], [770, 480], [770, 540],
          [840, 540], [840, 570], [860, 540], [860, 600],
        ].map(([x, y], i) => <rect key={i} x={x} y={y} width="8" height="12" />)}
      </g>

      <rect x="0" y="560" width="900" height="140" fill="url(#fade)" />
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
      <div className="login-hero">
        <SkylineBackground />
        <div className="login-hero-content">
          <div className="login-hero-mark">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M3 21V9.5L12 3l9 6.5V21H14v-7h-4v7H3z" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <h1>Every lead, deal, and client — in one place.</h1>
          <p>Sign in to your business's private workspace. Your data stays completely separate from every other client's.</p>
          <ul className="login-hero-features">
            <li><span className="tick">✓</span> Track leads from enquiry to closing</li>
            <li><span className="tick">✓</span> Manage bookings, payments &amp; documents</li>
            <li><span className="tick">✓</span> Your own private, isolated workspace</li>
          </ul>
        </div>
      </div>

      <div className="login-form-panel">
        <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 380, padding: 32 }}>
          <div className="login-card-mark">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path d="M3 21V9.5L12 3l9 6.5V21H14v-7h-4v7H3z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 21 }}>Sign in</h1>
          <p className="muted" style={{ marginTop: 0, marginBottom: 22, fontSize: 13 }}>
            Welcome back — log in with your business account.
          </p>

          {err && <div className="form-error" style={{ marginBottom: 14 }}>{err}</div>}

          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                   autoComplete="username" required autoFocus placeholder="you@business.com" />
          </div>
          <div className="field" style={{ marginBottom: 4 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                   autoComplete="current-password" required placeholder="••••••••" />
          </div>

          <button type="submit" className="primary" disabled={busy || !email.trim() || !password}
                  style={{ width: '100%', marginTop: 20, padding: '10px 0', fontSize: 14 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
