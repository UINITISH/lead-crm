import Icon from '../components/Icon.jsx';
import { fmt, tagColorClass } from '../lib/format.js';
import { token } from '../lib/api.js';
import { STATUSES } from '../constants.js';
import LeadActionsMenu from '../components/LeadActionsMenu.jsx';

/** Splits "Prestige Group, Sumadhura Group" into separate small tags instead of one long string. */
function DeveloperPills({ developerName, projectName }) {
  const names = (developerName || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!names.length) return <>{projectName || '—'}</>;
  return (
    <div className="dev-pills">
      {names.map((n, i) => <span className="dev-pill" key={i}>{n}</span>)}
      {projectName && <span className="muted" style={{ fontSize: 11, width: '100%' }}>{projectName}</span>}
    </div>
  );
}

export default function LeadsPage({ leads, report, filters, setFilters, loading, error, load, open, setShowAdd, onEditLead, onDeleteLead, tags = [], onSetStatus, onSetTag }) {
  const total = leads.length;
  const bySource = (s) => leads.filter(l => l.source === s).length;
  const manual = leads.filter(l => l.entry_method === 'manual').length;

  return (
    <>
      <div className="topbar">
        <h1>Leads</h1>
        <div className="grow" />
        <input placeholder="Search name / phone / email" value={filters.q}
               onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} style={{ width: 220 }} />
        <select value={filters.source} onChange={e => setFilters(f => ({ ...f, source: e.target.value }))}>
          <option value="">All sources</option>
          <option value="meta">Meta</option>
          <option value="google">Google</option>
          <option value="website">Website</option>
        </select>
        <select value={filters.status} onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select value={filters.tag || ''} onChange={e => setFilters(f => ({ ...f, tag: e.target.value }))}>
          <option value="">All tags</option>
          {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
        </select>
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
        <button className="primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={14} /> Add lead</button>
        <button onClick={() => window.open('/api/admin/export.csv?token=' + encodeURIComponent(token()))}>
          <Icon name="download" size={14} /> Export CSV
        </button>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{error}</div>}

      <div className="cards">
        <div className="card"><div className="n">{total}</div><div className="l">Unique leads</div></div>
        <div className="card"><div className="n" style={{ color: '#1a56db' }}>{bySource('meta')}</div><div className="l">Meta</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--warn)' }}>{bySource('google')}</div><div className="l">Google</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--good)' }}>{bySource('website')}</div><div className="l">Website</div></div>
        <div className="card"><div className="n" style={{ color: 'var(--pro)' }}>{manual}</div><div className="l">Manual entries</div></div>
      </div>

      <h2>Leads</h2>
      <table>
        <thead><tr>
          <th>Received</th><th>Source</th><th>Developer / project</th><th>Name</th>
          <th>Phone</th><th>Budget</th><th>Status</th><th>Tag</th><th>Entry</th><th></th>
        </tr></thead>
        <tbody>
          {leads.map(l => (
            <tr key={l.id} onClick={() => open(l.id)}>
              <td className="muted">{fmt(l.created_at)}</td>
              <td><span className={'pill src-' + l.source}>{l.source}</span></td>
              <td className="muted">
                {l.developer_name || l.project_name
                  ? <DeveloperPills developerName={l.developer_name} projectName={l.project_name} />
                  : (l.campaign_name || l.utm_campaign || '—')}
              </td>
              <td>{l.full_name || '—'}</td>
              <td>{l.phone_e164}</td>
              <td className="muted">{l.budget_range || '—'}</td>
              <td onClick={e => e.stopPropagation()}>
                <select className={'pill-select st-' + l.status} value={l.status}
                        onChange={e => onSetStatus(l.id, e.target.value)}>
                  {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </select>
              </td>
              <td onClick={e => e.stopPropagation()}>
                <select className={'pill-select ' + tagColorClass(tags, l.tag)} value={l.tag || ''}
                        onChange={e => onSetTag(l.id, e.target.value)}>
                  <option value="">No tag</option>
                  {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </td>
              <td><span className={'pill em-' + l.entry_method}>{l.entry_method === 'manual' ? 'Manual' : 'Auto'}</span></td>
              <td>
                <LeadActionsMenu onEdit={() => onEditLead(l)} onDelete={() => onDeleteLead(l)} />
              </td>
            </tr>
          ))}
          {!leads.length && !loading && <tr><td colSpan={10} className="empty">No leads match these filters.</td></tr>}
          {loading && <tr><td colSpan={10} className="empty">Loading…</td></tr>}
        </tbody>
      </table>
    </>
  );
}
