import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';
import { fmt } from '../lib/format.js';

const CLOSE_MS = 260; // matches the .side-panel transition duration in styles.css

const STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const STATUS_LABELS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };
const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const DEPARTMENTS = ['general', 'sales', 'payments', 'documentation', 'site_visit'];
const DEPARTMENT_LABELS = { general: 'General', sales: 'Sales', payments: 'Payments', documentation: 'Documentation', site_visit: 'Site visit' };

/** Shared shell for side panels — same pattern used by Lead forms. */
function SidePanel({ title, onClose, children }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  function dismiss() {
    setOpen(false);
    setTimeout(onClose, CLOSE_MS);
  }

  useEffect(() => {
    const onDocClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) dismiss();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={'side-panel' + (open ? ' open' : '')} ref={panelRef} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>{title}</h1>
        <div className="grow" />
        <button onClick={dismiss}><Icon name="x" size={14} /></button>
      </div>
      {children(dismiss)}
    </div>
  );
}

function NewTicketPanel({ reps, actingAs, onClose, onSaved }) {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [department, setDepartment] = useState('general');
  const [priority, setPriority] = useState('medium');
  const [assignee, setAssignee] = useState('');
  const [requester, setRequester] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!subject.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await api('/tickets', {
        method: 'POST',
        body: JSON.stringify({
          subject: subject.trim(), description, department, priority,
          assignee: assignee || null, requester: requester || null,
          actor: actingAs || 'admin',
        }),
      });
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    }
    setSaving(false);
  }

  return (
    <SidePanel title="New ticket" onClose={onClose}>
      {(dismiss) => (
        <form onSubmit={submit}>
          {err && <div className="form-error" style={{ marginTop: 16 }}>{err}</div>}

          <div className="field" style={{ marginTop: 16 }}>
            <label>Subject *</label>
            <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="e.g. Loan sanction letter delayed" required />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What's going on, and what's needed?" />
          </div>
          <div className="row2">
            <div className="field">
              <label>Department</label>
              <select value={department} onChange={(e) => setDepartment(e.target.value)}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Assign to</label>
              {reps.length > 0 ? (
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">Unassigned</option>
                  {reps.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                </select>
              ) : (
                <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Rep name" />
              )}
            </div>
            <div className="field">
              <label>Requester</label>
              <input value={requester} onChange={(e) => setRequester(e.target.value)} placeholder="Who raised this" />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" onClick={dismiss}>Cancel</button>
            <button type="submit" className="primary" disabled={saving || !subject.trim()}>
              {saving ? 'Creating…' : 'Create ticket'}
            </button>
          </div>
        </form>
      )}
    </SidePanel>
  );
}

function TicketDetailPanel({ ticket, reps, actingAs, onClose, onChanged }) {
  const [noteDraft, setNoteDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState(null);

  async function patch(fields) {
    setErr(null);
    try {
      await api('/tickets/' + ticket.id, { method: 'PATCH', body: JSON.stringify({ ...fields, actor: actingAs || 'admin' }) });
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  }

  async function postNote() {
    if (!noteDraft.trim()) return;
    setPosting(true);
    try {
      await patch({ note: noteDraft.trim() });
      setNoteDraft('');
    } finally {
      setPosting(false);
    }
  }

  return (
    <SidePanel title={ticket.subject} onClose={onClose}>
      {() => (
        <>
          {err && <div className="form-error" style={{ marginTop: 16 }}>{err}</div>}

          <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {STATUSES.map((s) => (
              <button key={s} className={ticket.status === s ? 'primary' : ''} onClick={() => patch({ status: s })}>
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>

          {ticket.description && (
            <>
              <h2>Description</h2>
              <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap' }}>{ticket.description}</p>
            </>
          )}

          <h2>Details</h2>
          <div className="row2">
            <div className="field">
              <label>Department</label>
              <select value={ticket.department} onChange={(e) => patch({ department: e.target.value })}>
                {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Priority</label>
              <select value={ticket.priority} onChange={(e) => patch({ priority: e.target.value })}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
              </select>
            </div>
          </div>
          <div className="row2">
            <div className="field">
              <label>Assigned to</label>
              {reps.length > 0 ? (
                <select value={ticket.assignee || ''} onChange={(e) => patch({ assignee: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {reps.map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                  {ticket.assignee && !reps.some((r) => r.name === ticket.assignee) && (
                    <option value={ticket.assignee}>{ticket.assignee} (not in Team list)</option>
                  )}
                </select>
              ) : (
                <input defaultValue={ticket.assignee || ''} onBlur={(e) => patch({ assignee: e.target.value || null })} placeholder="Rep name" />
              )}
            </div>
            <div className="field">
              <label>Requester</label>
              <input defaultValue={ticket.requester || ''} onBlur={(e) => patch({ requester: e.target.value || null })} placeholder="Who raised this" />
            </div>
          </div>
          {ticket.lead_name && (
            <div className="field">
              <label>Linked lead</label>
              <div style={{ fontSize: 13.5 }}>{ticket.lead_name} · {ticket.lead_phone}</div>
            </div>
          )}

          <h2>Activity</h2>
          <div className="activity-add">
            <textarea value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Add an update…"
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); postNote(); } }} />
            <button className="primary" disabled={posting || !noteDraft.trim()} onClick={postNote}>
              {posting ? 'Posting…' : 'Post'}
            </button>
          </div>
          {[...(ticket.events || [])].reverse().map((ev) => (
            <div className="event" key={ev.id}>
              <span className="muted">{fmt(ev.created_at)}</span>
              {ev.actor ? <span className="muted"> · {ev.actor}</span> : null}
              {ev.to_status ? ` → ${STATUS_LABELS[ev.to_status] || ev.to_status}` : ''}
              {ev.note ? <div>{ev.note}</div> : null}
            </div>
          ))}
          {!(ticket.events || []).length && <div className="muted" style={{ fontSize: 12 }}>No activity yet.</div>}
        </>
      )}
    </SidePanel>
  );
}

export default function TicketsPage({ reps = [], actingAs }) {
  const [tickets, setTickets] = useState([]);
  const [stats, setStats] = useState(null);
  const [filters, setFilters] = useState({ status: '', priority: '', department: '', q: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [selectedId, setSelectedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
      const [t, s] = await Promise.all([api('/tickets?' + qs), api('/ticket-stats')]);
      setTickets(t.tickets || []);
      setStats(s.stats);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const [selectedTicket, setSelectedTicket] = useState(null);
  async function openTicket(id) {
    const r = await api('/tickets/' + id);
    setSelectedTicket(r.ticket);
    setSelectedId(id);
  }
  async function refreshSelected() {
    if (selectedId) await openTicket(selectedId);
    load();
  }

  return (
    <>
      <div className="topbar">
        <h1>Support tickets</h1>
        <div className="grow" />
        <input placeholder="Search subject / description / requester" value={filters.q}
               onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))} style={{ width: 240 }} />
        <select value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
        <select value={filters.priority} onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
        </select>
        <select value={filters.department} onChange={(e) => setFilters((f) => ({ ...f, department: e.target.value }))}>
          <option value="">All departments</option>
          {DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}
        </select>
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
        <button className="primary" onClick={() => setShowNew(true)}><Icon name="plus" size={14} /> New ticket</button>
      </div>

      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}

      {stats && (
        <div className="cards">
          <div className="card"><div className="n">{stats.total}</div><div className="l">Total</div></div>
          <div className="card"><div className="n" style={{ color: 'var(--accent)' }}>{stats.open}</div><div className="l">Open</div></div>
          <div className="card"><div className="n" style={{ color: 'var(--warn)' }}>{stats.in_progress}</div><div className="l">In progress</div></div>
          <div className="card"><div className="n" style={{ color: 'var(--good)' }}>{stats.resolved}</div><div className="l">Resolved</div></div>
          <div className="card"><div className="n" style={{ color: 'var(--bad)' }}>{stats.urgent_open}</div><div className="l">Urgent &amp; open</div></div>
        </div>
      )}

      <h2>Tickets</h2>
      <table>
        <thead><tr>
          <th>Subject</th><th>Requester</th><th>Department</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Raised</th>
        </tr></thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} onClick={() => openTicket(t.id)}>
              <td>{t.subject}</td>
              <td className="muted">{t.requester || t.lead_name || '—'}</td>
              <td className="muted">{DEPARTMENT_LABELS[t.department] || t.department}</td>
              <td><span className={'pill pri-' + t.priority}>{t.priority}</span></td>
              <td><span className={'pill tkt-' + t.status}>{STATUS_LABELS[t.status]}</span></td>
              <td className="muted">{t.assignee || 'Unassigned'}</td>
              <td className="muted">{fmt(t.created_at)}</td>
            </tr>
          ))}
          {!tickets.length && !loading && <tr><td colSpan={7} className="empty">No tickets match these filters.</td></tr>}
          {loading && <tr><td colSpan={7} className="empty">Loading…</td></tr>}
        </tbody>
      </table>

      {showNew && (
        <NewTicketPanel reps={reps} actingAs={actingAs} onClose={() => setShowNew(false)}
                         onSaved={() => { setShowNew(false); load(); }} />
      )}
      {selectedTicket && (
        <TicketDetailPanel ticket={selectedTicket} reps={reps} actingAs={actingAs}
                            onClose={() => { setSelectedTicket(null); setSelectedId(null); }}
                            onChanged={refreshSelected} />
      )}
    </>
  );
}
