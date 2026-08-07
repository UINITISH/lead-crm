import { useState, useEffect } from 'react';
import Icon from '../components/Icon.jsx';
import { fmt, tagColorClass } from '../lib/format.js';
import { token } from '../lib/api.js';
import { STATUSES } from '../constants.js';
import LeadActionsMenu from '../components/LeadActionsMenu.jsx';
import Pagination from '../components/Pagination.jsx';

const LEADS_PAGE_SIZE = 50;

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

/** Small "×N" badge for a lead that's enquired more than once — hidden entirely for a first-time enquiry. */
function OccurrenceBadge({ n }) {
  if (!n || n <= 1) return <span className="muted">—</span>;
  return <span className="pill tag-orange" title={`Enquired ${n} times`}>×{n}</span>;
}

function StatusTagSelects({ l, tags, onSetStatus, onSetTag }) {
  return (
    <>
      <select className={'pill-select st-' + l.status} value={l.status}
              onChange={e => onSetStatus(l.id, e.target.value)}>
        {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
      </select>
      <select className={'pill-select ' + tagColorClass(tags, l.tag)} value={l.tag || ''}
              onChange={e => onSetTag(l.id, e.target.value)} style={{ marginLeft: 6 }}>
        <option value="">No tag</option>
        {tags.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
      </select>
    </>
  );
}

export default function LeadsPage({ leads, report, filters, setFilters, loading, error, load, open, setShowAdd, onEditLead, onDeleteLead, tags = [], onSetStatus, onSetTag }) {
  const [view, setView] = useState(() => localStorage.getItem('leadsView') || 'table');
  function setViewMode(v) {
    setView(v);
    localStorage.setItem('leadsView', v);
  }

  const total = leads.length;
  const bySource = (s) => leads.filter(l => l.source === s).length;

  // Table/card rows are paginated client-side — the leads array here is
  // already the full filtered set (fetched once), so "page 2" is just a
  // different slice of it, no extra request. Resets to page 1 whenever the
  // filters actually change, but NOT on every reload (e.g. after flipping a
  // single lead's status) — that would be a jarring "why did I jump back to
  // page 1" every time someone edits something on page 4.
  const [tablePage, setTablePage] = useState(1);
  useEffect(() => { setTablePage(1); }, [filters.source, filters.status, filters.tag, filters.q]);
  const totalPages = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  useEffect(() => { if (tablePage > totalPages) setTablePage(totalPages); }, [totalPages, tablePage]);
  const pageLeads = leads.slice((tablePage - 1) * LEADS_PAGE_SIZE, tablePage * LEADS_PAGE_SIZE);

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
        <div className="kebab-wrap" style={{ display: 'flex', border: '1px solid var(--line)', borderRadius: 7, overflow: 'hidden' }}>
          <button title="Table view" onClick={() => setViewMode('table')}
                  style={{ border: 'none', borderRadius: 0, background: view === 'table' ? 'var(--accent-bg)' : '#fff', color: view === 'table' ? 'var(--accent)' : 'var(--muted)' }}>
            <Icon name="list" size={14} />
          </button>
          <button title="Card view" onClick={() => setViewMode('card')}
                  style={{ border: 'none', borderRadius: 0, background: view === 'card' ? 'var(--accent-bg)' : '#fff', color: view === 'card' ? 'var(--accent)' : 'var(--muted)' }}>
            <Icon name="grid" size={14} />
          </button>
        </div>
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
      </div>

      <h2>
        Leads
        {total > 0 && (
          <span className="muted" style={{ fontWeight: 400, fontSize: 12.5, marginLeft: 8 }}>
            {(tablePage - 1) * LEADS_PAGE_SIZE + 1}–{Math.min(tablePage * LEADS_PAGE_SIZE, total)} of {total}
          </span>
        )}
      </h2>

      {view === 'table' ? (
        <table>
          <thead><tr>
            <th>Received</th><th>Source</th><th>Developer / project</th><th>Name</th>
            <th>Phone</th><th>Budget</th><th>Status</th><th>Tag</th><th>Occ.</th><th></th>
          </tr></thead>
          <tbody>
            {pageLeads.map(l => (
              <tr key={l.id} className={l.viewed_at ? '' : 'lead-unviewed'} onClick={() => open(l.id)}>
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
                <td><OccurrenceBadge n={l.occurrence_count} /></td>
                <td>
                  <LeadActionsMenu onEdit={() => onEditLead(l)} onDelete={() => onDeleteLead(l)} />
                </td>
              </tr>
            ))}
            {!leads.length && !loading && <tr><td colSpan={10} className="empty">No leads match these filters.</td></tr>}
            {loading && <tr><td colSpan={10} className="empty">Loading…</td></tr>}
          </tbody>
        </table>
      ) : (
        <div className="cards" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))' }}>
          {pageLeads.map(l => (
            <div className={'card' + (l.viewed_at ? '' : ' lead-unviewed')} key={l.id} style={{ cursor: 'pointer' }} onClick={() => open(l.id)}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: l.viewed_at ? 600 : 800, fontSize: 14 }}>{l.full_name || 'Unnamed lead'}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{l.phone_e164}</div>
                </div>
                <span className={'pill src-' + l.source}>{l.source}</span>
              </div>

              <div style={{ marginTop: 10, fontSize: 12.5 }}>
                {l.developer_name || l.project_name
                  ? <DeveloperPills developerName={l.developer_name} projectName={l.project_name} />
                  : <span className="muted">{l.campaign_name || l.utm_campaign || 'No developer/project set'}</span>}
              </div>

              <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
                {l.budget_range || 'Budget not set'} · {fmt(l.created_at)}
                {l.occurrence_count > 1 && <> · <span style={{ color: 'var(--warn)' }}>enquired {l.occurrence_count}×</span></>}
              </div>

              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                <StatusTagSelects l={l} tags={tags} onSetStatus={onSetStatus} onSetTag={onSetTag} />
                <div className="grow" />
                <LeadActionsMenu onEdit={() => onEditLead(l)} onDelete={() => onDeleteLead(l)} />
              </div>
            </div>
          ))}
          {!leads.length && !loading && <div className="empty" style={{ gridColumn: '1/-1' }}>No leads match these filters.</div>}
          {loading && <div className="empty" style={{ gridColumn: '1/-1' }}>Loading…</div>}
        </div>
      )}

      <Pagination page={tablePage} totalPages={totalPages} onPageChange={setTablePage} />
    </>
  );
}
