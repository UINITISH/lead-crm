import { useState, useEffect, useCallback } from 'react';
import Icon from './components/Icon.jsx';
import AddLeadModal from './components/AddLeadModal.jsx';
import DealEditModal from './components/DealEditModal.jsx';
import FollowUpQuickAdd from './components/FollowUpQuickAdd.jsx';
import CreateDealQuickAdd from './components/CreateDealQuickAdd.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import DealsPage from './pages/DealsPage.jsx';
import DevelopersPage from './pages/DevelopersPage.jsx';
import IngestLogPage from './pages/IngestLogPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import { api } from './lib/api.js';
import { fmt, fmtINR } from './lib/format.js';
import { STATUSES, NAV, DEAL_STAGE_LABELS, DEAL_ELIGIBLE_STATUSES } from './constants.js';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [leads, setLeads] = useState([]);
  const [report, setReport] = useState([]);
  const [filters, setFilters] = useState({ source: '', status: '', q: '' });
  const [selected, setSelected] = useState(null);
  const [selectedFollowups, setSelectedFollowups] = useState([]);
  const [selectedDeals, setSelectedDeals] = useState([]);
  const [editingDeal, setEditingDeal] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [actingAs, setActingAs] = useState(sessionStorage.getItem('crm_actor') || '');
  const [companyName, setCompanyName] = useState('Core Value Realty');
  const [reps, setReps] = useState([]);

  useEffect(() => {
    if (actingAs) sessionStorage.setItem('crm_actor', actingAs);
  }, [actingAs]);

  useEffect(() => {
    async function loadMeta() {
      try {
        const [s, r] = await Promise.all([api('/settings'), api('/reps?active_only=1')]);
        setCompanyName(s.settings?.company_name || 'Core Value Realty');
        setReps(r.reps || []);
      } catch { /* sidebar falls back to defaults */ }
    }
    loadMeta();
    window.addEventListener('crm-settings-changed', loadMeta);
    return () => window.removeEventListener('crm-settings-changed', loadMeta);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const [l, rep] = await Promise.all([api('/leads?' + qs), api('/report/source')]);
      setLeads(l.leads || []);
      setReport(rep.rows || []);
      setError(null);
    } catch (e) { setError(e.message); }
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  async function open(id) {
    const [r, fr, dr] = await Promise.all([
      api('/leads/' + id), api('/leads/' + id + '/followups'), api('/leads/' + id + '/deals'),
    ]);
    setSelected(r.lead);
    setSelectedFollowups(fr.followups || []);
    setSelectedDeals(dr.deals || []);
  }

  async function setStatus(id, status) {
    await api(`/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, actor: actingAs || 'admin' }) });
    await load();
    if (selected?.id === id) open(id);
  }

  return (
    <>
      <div className="sidebar">
        <div className="brand">
          <p className="name">{companyName}</p>
          <p className="tag">Phase 1</p>
        </div>
        {NAV.map(n => (
          <button key={n.key} className={'nav-item' + (page === n.key ? ' active' : '')}
                  onClick={() => setPage(n.key)}>
            <Icon name={n.icon} size={17} />{n.label}
          </button>
        ))}
        <div className="sidebar-footer">
          <label style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>Acting as</label>
          {reps.length > 0 ? (
            <select value={actingAs} onChange={e => setActingAs(e.target.value)}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}>
              <option value="">Select…</option>
              {actingAs && !reps.some(r => r.name === actingAs) && (
                <option value={actingAs}>{actingAs} (not in Team list)</option>
              )}
              {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
            </select>
          ) : (
            <input value={actingAs} onChange={e => setActingAs(e.target.value)} placeholder="Your name"
                   style={{ width: '100%', fontSize: 12, padding: '6px 8px' }} />
          )}
          <p style={{ margin: '6px 0 0', fontSize: 10.5 }}>
            {reps.length > 0 ? 'Add or remove reps from Settings → Team.' : 'Add your team under Settings → Team.'}
          </p>
        </div>
      </div>

      <main>
        {page === 'leads' && (
          <LeadsPage leads={leads} report={report} filters={filters} setFilters={setFilters}
                     loading={loading} error={error} load={load} open={open} setShowAdd={setShowAdd} />
        )}
        {page === 'dashboard' && <DashboardPage leads={leads} report={report} load={load} actingAs={actingAs} />}
        {page === 'deals' && <DealsPage actingAs={actingAs} />}
        {page === 'developers' && <DevelopersPage />}
        {page === 'ingest' && <IngestLogPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}

      {editingDeal && (
        <DealEditModal
          deal={editingDeal}
          actingAs={actingAs}
          onClose={() => setEditingDeal(null)}
          onSaved={() => { setEditingDeal(null); if (selected) open(selected.id); }}
        />
      )}

      {selected && (
        <div className="drawer" onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <h1 style={{ margin: 0 }}>{selected.full_name || 'Unnamed lead'}</h1>
            <div className="grow" />
            <button onClick={() => setSelected(null)}><Icon name="x" size={14} /></button>
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map(s => (
              <button key={s}
                      className={selected.status === s ? 'primary' : ''}
                      onClick={() => setStatus(selected.id, s)}>
                {s.replace('_', ' ')}
              </button>
            ))}
          </div>

          <h2>Contact</h2>
          <dl className="kv">
            <dt>Phone</dt><dd><a href={'tel:' + selected.phone_e164} style={{ color: 'var(--accent)' }}>{selected.phone_e164}</a></dd>
            <dt>Email</dt><dd>{selected.email || '—'}</dd>
            <dt>Budget</dt><dd>{selected.budget_range || '—'}</dd>
            <dt>Timeline</dt><dd>{selected.timeline || '—'}</dd>
            <dt>Developer</dt><dd>{selected.developer_name || '—'}</dd>
            <dt>Project</dt><dd>{selected.project_name || '—'}</dd>
          </dl>

          <h2>Entry</h2>
          <dl className="kv">
            <dt>Method</dt><dd><span className={'pill em-' + selected.entry_method}>{selected.entry_method === 'manual' ? 'Manual entry' : 'Automatic (webhook)'}</span></dd>
            {selected.entry_method === 'manual' && (<><dt>Entered by</dt><dd>{selected.created_by || '—'}</dd></>)}
          </dl>

          <h2>Follow-ups</h2>
          {selectedFollowups.map(f => (
            <div className="event" key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, borderLeftColor: f.is_done ? 'var(--good)' : 'var(--line)' }}>
              <div style={{ flex: 1 }}>
                <span className={f.is_done ? 'muted' : ''}>{fmt(f.due_at)}</span>{f.note ? ' · ' + f.note : ''}
              </div>
              {!f.is_done && (
                <button style={{ padding: '2px 8px', fontSize: 11 }}
                        onClick={async () => { await api('/followups/' + f.id, { method: 'PATCH', body: JSON.stringify({ done: true }) }); open(selected.id); }}>
                  Done
                </button>
              )}
            </div>
          ))}
          {!selectedFollowups.length && <div className="muted" style={{ fontSize: 12 }}>No follow-ups scheduled.</div>}
          <FollowUpQuickAdd leadId={selected.id} actingAs={actingAs} onAdded={() => open(selected.id)} />

          <h2>Deal</h2>
          {selectedDeals.map(d => (
            <div className="list-row" key={d.id} style={{ cursor: 'pointer' }} onClick={() => setEditingDeal({ ...d, full_name: selected.full_name })}>
              <div style={{ flex: 1 }}>
                <span className={'pill deal-' + d.stage}>
                  {DEAL_STAGE_LABELS[d.stage]}
                </span>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {d.unit_number || 'No unit set'} · {fmtINR(d.agreed_price)}
                  {d.expected_closing_date ? ' · closing ' + new Date(d.expected_closing_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : ''}
                </div>
              </div>
            </div>
          ))}
          {!selectedDeals.length && (
            DEAL_ELIGIBLE_STATUSES.includes(selected.status) ? (
              <CreateDealQuickAdd leadId={selected.id} actingAs={actingAs} onCreated={() => open(selected.id)} />
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>
                A deal can be opened once this lead reaches negotiation.
              </div>
            )
          )}

          <h2>Attribution</h2>
          <dl className="kv">
            <dt>Source</dt><dd><span className={'pill src-' + selected.source}>{selected.source}</span></dd>
            <dt>Campaign</dt><dd>{selected.campaign_name || '—'} <span className="muted">{selected.campaign_id || ''}</span></dd>
            <dt>Ad set / group</dt><dd>{selected.adset_name || selected.adset_id || '—'}</dd>
            <dt>Ad / creative</dt><dd>{selected.ad_name || selected.ad_id || '—'}</dd>
            <dt>utm_source</dt><dd>{selected.utm_source || '—'}</dd>
            <dt>utm_medium</dt><dd>{selected.utm_medium || '—'}</dd>
            <dt>utm_campaign</dt><dd>{selected.utm_campaign || '—'}</dd>
            <dt>gclid</dt><dd className="muted">{selected.gclid || '—'}</dd>
            <dt>Landing page</dt><dd className="muted">{selected.landing_page || '—'}</dd>
            <dt>Referrer</dt><dd className="muted">{selected.referrer || '—'}</dd>
            <dt>First touch</dt><dd className="muted">{selected.first_touch ? JSON.stringify(selected.first_touch) : '—'}</dd>
          </dl>

          <h2>Lifecycle</h2>
          {(selected.events || []).map(ev => (
            <div className="event" key={ev.id}>
              <span className="muted">{fmt(ev.created_at)}</span> · {ev.event_type}
              {ev.to_status ? ` → ${ev.to_status}` : ''}
              {ev.note ? <div className="muted">{ev.note}</div> : null}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
