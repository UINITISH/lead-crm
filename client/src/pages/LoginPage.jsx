import { useState } from 'react';
import { login } from '../lib/api.js';

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
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg, #f6f7f9)', padding: 16,
    }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 360, padding: 28 }}>
        <h1 style={{ marginTop: 0, marginBottom: 4, fontSize: 20 }}>Sign in</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20, fontSize: 13 }}>
          Log in with your business account.
        </p>

        {err && <div className="form-error" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                 autoComplete="username" required autoFocus />
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" required />
        </div>

        <button type="submit" className="primary" disabled={busy || !email.trim() || !password}
                style={{ width: '100%', marginTop: 20 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
