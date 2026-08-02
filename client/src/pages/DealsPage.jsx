import { useState, useEffect, useCallback, Fragment } from 'react';
import Icon from '../components/Icon.jsx';
import DealEditModal from '../components/DealEditModal.jsx';
import { api } from '../lib/api.js';
import { fmtINR } from '../lib/format.js';
import { DEAL_STAGES, DEAL_STAGE_LABELS } from '../constants.js';

export default function DealsPage({ actingAs }) {
  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api('/deals'), api('/deal-stats')]);
      setDeals(d.deals || []);
      setStats(s.stats);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const byStage = (stage) => deals.filter(d => d.stage === stage);

  return (
    <>
      <div className="topbar">
        <h1>Deals</h1>
        <div className="grow" />
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
      </div>

      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}

      {(loading || !stats) ? <div className="empty">{loadError ? ' ' : 'Loading…'}</div> : (
        <>
          <div className="cards">
            <div className="card"><div className="l">Open deals</div><div className="n">{stats.open_deals}</div></div>
            <div className="card"><div className="l">Open value</div><div className="n">{fmtINR(stats.open_value)}</div></div>
            <div className="card"><div className="l">Closing this month</div><div className="n">{stats.closing_this_month}</div></div>
            <div className="card"><div className="l">Win rate</div><div className="n">{stats.win_rate}%</div></div>
          </div>

          {DEAL_STAGES.map(stage => {
            const rows = byStage(stage);
            return (
              <Fragment key={stage}>
                <h2>{DEAL_STAGE_LABELS[stage]} ({rows.length})</h2>
                <table style={{ marginBottom: 20 }}>
                  <thead><tr>
                    <th>Lead</th><th>Developer / project</th><th>Unit</th><th>Price</th><th>Expected closing</th>
                  </tr></thead>
                  <tbody>
                    {rows.map(d => (
                      <tr key={d.id} onClick={() => setEditing(d)}>
                        <td>
                          {d.full_name || '—'}
                          <div className="muted" style={{ fontSize: 12 }}>{d.phone_e164}</div>
                        </td>
                        <td className="muted">{d.developer_name || '—'}{d.project_name ? ' · ' + d.project_name : ''}</td>
                        <td>{d.unit_number || '—'}</td>
                        <td>{fmtINR(d.agreed_price)}</td>
                        <td className="muted">{d.expected_closing_date ? new Date(d.expected_closing_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}</td>
                      </tr>
                    ))}
                    {!rows.length && <tr><td colSpan={5} className="empty">No deals at this stage.</td></tr>}
                  </tbody>
                </table>
              </Fragment>
            );
          })}
        </>
      )}

      {editing && (
        <DealEditModal deal={editing} actingAs={actingAs}
                       onClose={() => setEditing(null)}
                       onSaved={() => { setEditing(null); load(); }} />
      )}
    </>
  );
}
