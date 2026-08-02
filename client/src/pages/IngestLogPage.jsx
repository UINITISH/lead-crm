import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';

export default function IngestLogPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api('/report/ingest');
      setRows(r.rows || []);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <div className="topbar">
        <h1>Ingest log</h1>
        <div className="grow" />
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
      </div>
      <p className="muted" style={{ marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Every inbound hit from the last 30 days — accepted, duplicate, rejected, or errored. This is what you
        open when a platform's reported lead count doesn't match the CRM's.
      </p>
      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}
      <table>
        <thead><tr><th>Source</th><th>Outcome</th><th>Reason</th><th>Count</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td><span className={'pill src-' + r.source}>{r.source}</span></td>
              <td>{r.outcome}</td>
              <td className="muted">{r.reason || '—'}</td>
              <td>{r.n}</td>
            </tr>
          ))}
          {!rows.length && !loading && <tr><td colSpan={4} className="empty">Nothing logged in the last 30 days.</td></tr>}
          {loading && <tr><td colSpan={4} className="empty">Loading…</td></tr>}
        </tbody>
      </table>
    </>
  );
}
