import { useState, useEffect, useCallback } from 'react';
import Icon from './components/Icon.jsx';
import LeadNotifications from './components/LeadNotifications.jsx';
import AddLeadModal from './components/AddLeadModal.jsx';
import EditLeadModal from './components/EditLeadModal.jsx';
import LeadsPage from './pages/LeadsPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import TicketsPage from './pages/TicketsPage.jsx';
import DevelopersPage from './pages/DevelopersPage.jsx';
import FormsPage from './pages/FormsPage.jsx';
import IngestLogPage from './pages/IngestLogPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import HelpPage from './pages/HelpPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import { api, isLoggedIn, logout, business } from './lib/api.js';
import { NAV } from './constants.js';

export default function App() {
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  if (!loggedIn) return <LoginPage onSuccess={() => setLoggedIn(true)} />;
  return <Dashboard onLogout={() => setLoggedIn(false)} />;
}

function Dashboard({ onLogout }) {
  const [page, setPage] = useState('dashboard');
  const [leads, setLeads] = useState([]);
  const [report, setReport] = useState([]);
  const [filters, setFilters] = useState({ source: '', status: '', q: '' });
  const [editingLead, setEditingLead] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [actingAs, setActingAs] = useState(sessionStorage.getItem('crm_actor') || '');
  const [companyName, setCompanyName] = useState('Findmigo');
  const [reps, setReps] = useState([]);
  const [tags, setTags] = useState([]);

  useEffect(() => {
    if (actingAs) sessionStorage.setItem('crm_actor', actingAs);
  }, [actingAs]);

  useEffect(() => {
    async function loadMeta() {
      try {
        const [s, r, t] = await Promise.all([api('/settings'), api('/reps?active_only=1'), api('/tags?active_only=1')]);
        setCompanyName(s.settings?.company_name || 'Findmigo');
        setReps(r.reps || []);
        setTags(t.tags || []);
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

  async function setStatus(id, status) {
    await api(`/leads/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status, actor: actingAs || 'admin' }) });
    await load();
  }

  async function setTag(id, tag) {
    await api(`/leads/${id}`, { method: 'PATCH', body: JSON.stringify({ tag: tag || null, actor: actingAs || 'admin' }) });
    await load();
  }

  async function deleteLead(lead) {
    const ok = window.confirm(`Delete ${lead.full_name || lead.phone_e164}? This removes the lead and its whole history — can't be undone.`);
    if (!ok) return;
    await api('/leads/' + lead.id, { method: 'DELETE' });
    await load();
  }

  return (
    <>
      <div className="sidebar">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p className="name">{companyName}</p>
          <LeadNotifications onOpenLead={() => { setPage('leads'); load(); }} />
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
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            {business()?.email && (
              <p className="muted" style={{ margin: '0 0 6px', fontSize: 10.5, wordBreak: 'break-all' }}>
                {business().email}
              </p>
            )}
            <button
              onClick={() => { logout(); onLogout(); }}
              style={{ width: '100%', fontSize: 12, padding: '6px 8px' }}
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      <main>
        {page === 'leads' && (
          <LeadsPage leads={leads} report={report} filters={filters} setFilters={setFilters}
                     loading={loading} error={error} load={load} setShowAdd={setShowAdd}
                     onEditLead={setEditingLead} onDeleteLead={deleteLead} tags={tags}
                     onSetStatus={setStatus} onSetTag={setTag} />
        )}
        {page === 'dashboard' && <DashboardPage leads={leads} report={report} load={load} actingAs={actingAs} />}
        {page === 'tickets' && <TicketsPage reps={reps} actingAs={actingAs} />}
        {page === 'developers' && <DevelopersPage />}
        {page === 'forms' && <FormsPage />}
        {page === 'ingest' && <IngestLogPage />}
        {page === 'settings' && <SettingsPage />}
        {page === 'help' && <HelpPage />}
      </main>

      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); load(); }}
        />
      )}

      {editingLead && (
        <EditLeadModal
          lead={editingLead}
          actingAs={actingAs}
          onClose={() => setEditingLead(null)}
          onSaved={() => { setEditingLead(null); load(); }}
        />
      )}
    </>
  );
}
