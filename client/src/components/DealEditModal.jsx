import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { fmtINR } from '../lib/format.js';
import { DEAL_STAGES, DEAL_STAGE_LABELS } from '../constants.js';

const CLOSE_MS = 260; // matches the .side-panel transition duration in styles.css
const TABS = ['overview', 'applicants', 'cost', 'payments', 'documents'];
const TAB_LABELS = { overview: 'Overview', applicants: 'Applicants', cost: 'Cost sheet', payments: 'Payments', documents: 'Documents' };

function TabBar({ tab, setTab, counts }) {
  return (
    <div style={{ display: 'flex', gap: 4, marginTop: 16, borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
      {TABS.map((t) => (
        <button key={t} onClick={() => setTab(t)}
                style={{
                  border: 'none', borderRadius: '6px 6px 0 0', background: 'none', padding: '8px 10px', fontSize: 12.5,
                  color: tab === t ? 'var(--accent)' : 'var(--muted)',
                  borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: -1,
                }}>
          {TAB_LABELS[t]}{counts && counts[t] ? ` (${counts[t]})` : ''}
        </button>
      ))}
    </div>
  );
}

function OverviewTab({ deal, actingAs, onSaved }) {
  const [form, setForm] = useState({
    unit_number: deal.unit_number || '',
    agreed_price: deal.agreed_price ?? '',
    expected_closing_date: deal.expected_closing_date ? deal.expected_closing_date.slice(0, 10) : '',
    notes: deal.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    await api('/deals/' + deal.id, {
      method: 'PATCH',
      body: JSON.stringify({
        unit_number: form.unit_number || null,
        agreed_price: form.agreed_price !== '' ? Number(form.agreed_price) : null,
        expected_closing_date: form.expected_closing_date || null,
        notes: form.notes || null,
        actor: actingAs || 'admin',
      }),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <form onSubmit={save} style={{ marginTop: 16 }}>
      <div className="row2">
        <div className="field">
          <label>Unit / flat number</label>
          <input value={form.unit_number} onChange={set('unit_number')} placeholder="C-1704" />
        </div>
        <div className="field">
          <label>Agreed price (₹ lakhs)</label>
          <input type="number" value={form.agreed_price} onChange={set('agreed_price')} placeholder="185" />
        </div>
      </div>
      <div className="field">
        <label>Expected closing date</label>
        <input type="date" value={form.expected_closing_date} onChange={set('expected_closing_date')} />
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea value={form.notes} onChange={set('notes')} />
      </div>
      <div className="modal-actions" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}

const RELATIONS = [{ v: 'primary', l: 'Primary' }, { v: 'co_applicant', l: 'Co-applicant' }];

function ApplicantsTab({ dealId, applicants, onChanged }) {
  const [draft, setDraft] = useState({ full_name: '', relation: 'primary', phone: '', email: '' });
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!draft.full_name.trim()) return;
    setAdding(true);
    try {
      await api(`/deals/${dealId}/applicants`, { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ full_name: '', relation: 'primary', phone: '', email: '' });
      onChanged();
    } finally { setAdding(false); }
  }
  async function patch(id, fields) {
    await api('/deal-applicants/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
    onChanged();
  }
  async function remove(id) {
    await api('/deal-applicants/' + id, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {applicants.map((a) => (
        <div className="list-row" key={a.id} style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <input defaultValue={a.full_name} onBlur={(e) => e.target.value !== a.full_name && patch(a.id, { full_name: e.target.value })}
                   style={{ marginBottom: 4, fontWeight: 600 }} />
            <div style={{ display: 'flex', gap: 6 }}>
              <input defaultValue={a.phone || ''} placeholder="Phone" style={{ fontSize: 12, flex: 1 }}
                     onBlur={(e) => e.target.value !== (a.phone || '') && patch(a.id, { phone: e.target.value })} />
              <input defaultValue={a.email || ''} placeholder="Email" style={{ fontSize: 12, flex: 1 }}
                     onBlur={(e) => e.target.value !== (a.email || '') && patch(a.id, { email: e.target.value })} />
            </div>
          </div>
          <select value={a.relation} onChange={(e) => patch(a.id, { relation: e.target.value })} style={{ fontSize: 12 }}>
            {RELATIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
          </select>
          <button onClick={() => remove(a.id)} title="Remove" style={{ color: 'var(--bad)', padding: '6px 8px' }}>
            <Icon name="trash-2" size={13} />
          </button>
        </div>
      ))}
      {!applicants.length && <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No applicants added yet.</div>}

      <div className="list-row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))}
               placeholder="Applicant name" style={{ flex: 1, minWidth: 140 }} />
        <select value={draft.relation} onChange={(e) => setDraft((d) => ({ ...d, relation: e.target.value }))} style={{ fontSize: 12 }}>
          {RELATIONS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
        </select>
        <button type="button" onClick={add} disabled={adding || !draft.full_name.trim()}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>
    </div>
  );
}

function CostSheetTab({ dealId, costItems, totals, onChanged }) {
  const [draft, setDraft] = useState({ label: '', amount: '' });
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!draft.label.trim()) return;
    setAdding(true);
    try {
      await api(`/deals/${dealId}/cost-items`, { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ label: '', amount: '' });
      onChanged();
    } finally { setAdding(false); }
  }
  async function patch(id, fields) {
    await api('/deal-cost-items/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
    onChanged();
  }
  async function remove(id) {
    await api('/deal-cost-items/' + id, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {costItems.map((c) => (
        <div className="list-row" key={c.id} style={{ gap: 8 }}>
          <input defaultValue={c.label} style={{ flex: 1 }}
                 onBlur={(e) => e.target.value !== c.label && patch(c.id, { label: e.target.value })} />
          <input type="number" defaultValue={c.amount} style={{ width: 110 }}
                 onBlur={(e) => Number(e.target.value) !== Number(c.amount) && patch(c.id, { amount: e.target.value })} />
          <button onClick={() => remove(c.id)} title="Remove" style={{ color: 'var(--bad)', padding: '6px 8px' }}>
            <Icon name="trash-2" size={13} />
          </button>
        </div>
      ))}
      {!costItems.length && <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No cost items added yet.</div>}

      <div className="list-row" style={{ gap: 8, marginTop: 10 }}>
        <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
               placeholder="e.g. Base price, GST, Registration" style={{ flex: 1 }} />
        <input type="number" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
               placeholder="₹ lakhs" style={{ width: 110 }} />
        <button type="button" onClick={add} disabled={adding || !draft.label.trim()}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>

      {totals && costItems.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)', fontWeight: 600 }}>
          <span>Total cost</span><span>{fmtINR(totals.total_cost)}</span>
        </div>
      )}
    </div>
  );
}

const MILESTONE_STATUSES = ['pending', 'paid', 'overdue'];

function PaymentsTab({ dealId, milestones, totals, onChanged }) {
  const [draft, setDraft] = useState({ label: '', due_date: '', amount: '' });
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!draft.label.trim()) return;
    setAdding(true);
    try {
      await api(`/deals/${dealId}/milestones`, { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ label: '', due_date: '', amount: '' });
      onChanged();
    } finally { setAdding(false); }
  }
  async function patch(id, fields) {
    await api('/deal-milestones/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
    onChanged();
  }
  async function remove(id) {
    await api('/deal-milestones/' + id, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {milestones.map((m) => (
        <div className="list-row" key={m.id} style={{ alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <input defaultValue={m.label} style={{ marginBottom: 4, fontWeight: 600 }}
                   onBlur={(e) => e.target.value !== m.label && patch(m.id, { label: e.target.value })} />
            <div className="muted" style={{ fontSize: 11.5 }}>
              Due {m.due_date ? new Date(m.due_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
              {' · '}{fmtINR(m.amount)} scheduled
              {Number(m.paid_amount) > 0 ? ` · ${fmtINR(m.paid_amount)} paid` : ''}
            </div>
          </div>
          <input type="date" defaultValue={m.due_date ? m.due_date.slice(0, 10) : ''} style={{ fontSize: 12 }}
                 onBlur={(e) => (e.target.value || null) !== m.due_date && patch(m.id, { due_date: e.target.value })} />
          <input type="number" defaultValue={m.amount} placeholder="Amount" style={{ width: 90, fontSize: 12 }}
                 onBlur={(e) => Number(e.target.value) !== Number(m.amount) && patch(m.id, { amount: e.target.value })} />
          <select value={m.status} onChange={(e) => patch(m.id, { status: e.target.value })}
                  className={'pill-select tkt-' + (m.status === 'paid' ? 'resolved' : m.status === 'overdue' ? 'closed' : 'open')}
                  style={{ fontSize: 12 }}>
            {MILESTONE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => remove(m.id)} title="Remove" style={{ color: 'var(--bad)', padding: '6px 8px' }}>
            <Icon name="trash-2" size={13} />
          </button>
        </div>
      ))}
      {!milestones.length && <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No payment milestones scheduled yet.</div>}

      <div className="list-row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
               placeholder="e.g. Booking amount, On agreement" style={{ flex: 1, minWidth: 140 }} />
        <input type="date" value={draft.due_date} onChange={(e) => setDraft((d) => ({ ...d, due_date: e.target.value }))} style={{ fontSize: 12 }} />
        <input type="number" value={draft.amount} onChange={(e) => setDraft((d) => ({ ...d, amount: e.target.value }))}
               placeholder="₹ lakhs" style={{ width: 90 }} />
        <button type="button" onClick={add} disabled={adding || !draft.label.trim()}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>

      {totals && milestones.length > 0 && (
        <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--line)', fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Scheduled</span><span>{fmtINR(totals.total_scheduled)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--good)' }}><span>Paid</span><span>{fmtINR(totals.total_paid)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}><span>Due</span><span>{fmtINR(totals.total_due)}</span></div>
        </div>
      )}
    </div>
  );
}

const DOC_STATUSES = ['pending', 'received', 'verified'];

function DocumentsTab({ dealId, documents, onChanged }) {
  const [draft, setDraft] = useState({ name: '' });
  const [adding, setAdding] = useState(false);

  async function add() {
    if (!draft.name.trim()) return;
    setAdding(true);
    try {
      await api(`/deals/${dealId}/documents`, { method: 'POST', body: JSON.stringify(draft) });
      setDraft({ name: '' });
      onChanged();
    } finally { setAdding(false); }
  }
  async function patch(id, fields) {
    await api('/deal-documents/' + id, { method: 'PATCH', body: JSON.stringify(fields) });
    onChanged();
  }
  async function remove(id) {
    await api('/deal-documents/' + id, { method: 'DELETE' });
    onChanged();
  }

  return (
    <div style={{ marginTop: 16 }}>
      {documents.map((d) => (
        <div className="list-row" key={d.id} style={{ gap: 8, flexWrap: 'wrap' }}>
          <input defaultValue={d.name} style={{ flex: 1, minWidth: 140, fontWeight: 600 }}
                 onBlur={(e) => e.target.value !== d.name && patch(d.id, { name: e.target.value })} />
          <input defaultValue={d.reference || ''} placeholder="Where it is (e.g. reception, emailed 12 Aug)" style={{ flex: 1, minWidth: 160, fontSize: 12 }}
                 onBlur={(e) => e.target.value !== (d.reference || '') && patch(d.id, { reference: e.target.value })} />
          <select value={d.status} onChange={(e) => patch(d.id, { status: e.target.value })}
                  className={'pill-select tkt-' + (d.status === 'verified' ? 'resolved' : d.status === 'received' ? 'in_progress' : 'open')}
                  style={{ fontSize: 12 }}>
            {DOC_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button onClick={() => remove(d.id)} title="Remove" style={{ color: 'var(--bad)', padding: '6px 8px' }}>
            <Icon name="trash-2" size={13} />
          </button>
        </div>
      ))}
      {!documents.length && <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No documents tracked yet.</div>}

      <div className="list-row" style={{ gap: 8, marginTop: 10 }}>
        <input value={draft.name} onChange={(e) => setDraft({ name: e.target.value })}
               placeholder="e.g. PAN card, Sale agreement, Loan sanction letter" style={{ flex: 1 }} />
        <button type="button" onClick={add} disabled={adding || !draft.name.trim()}>
          <Icon name="plus" size={12} /> Add
        </button>
      </div>
    </div>
  );
}

export default function DealEditModal({ deal, onClose, onSaved, actingAs }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const [tab, setTab] = useState('overview');
  const [booking, setBooking] = useState(null);
  const [bookingError, setBookingError] = useState(null);

  const loadBooking = useCallback(async () => {
    try {
      const r = await api('/deals/' + deal.id + '/booking');
      setBooking(r);
      setBookingError(null);
    } catch (e) { setBookingError(e.message); }
  }, [deal.id]);

  useEffect(() => { loadBooking(); }, [loadBooking]);

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

  async function changeStage(stage) {
    await api('/deals/' + deal.id, { method: 'PATCH', body: JSON.stringify({ stage, actor: actingAs || 'admin' }) });
    onSaved();
  }

  const counts = booking ? {
    applicants: booking.applicants.length, cost: booking.cost_items.length,
    payments: booking.milestones.length, documents: booking.documents.length,
  } : null;

  return (
    <div className={'side-panel' + (open ? ' open' : '')} ref={panelRef} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>{deal.full_name || 'Deal'}</h1>
        <div className="grow" />
        <button onClick={dismiss}><Icon name="x" size={14} /></button>
      </div>
      <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
        {deal.developer_name} {deal.project_name ? '· ' + deal.project_name : ''}
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
        {DEAL_STAGES.map((s) => (
          <button key={s} className={deal.stage === s ? 'primary' : ''} onClick={() => changeStage(s)}>
            {DEAL_STAGE_LABELS[s]}
          </button>
        ))}
      </div>

      <TabBar tab={tab} setTab={setTab} counts={counts} />

      {tab === 'overview' && <OverviewTab deal={deal} actingAs={actingAs} onSaved={onSaved} />}

      {tab !== 'overview' && bookingError && <div className="form-error" style={{ marginTop: 16 }}>{bookingError}</div>}
      {tab !== 'overview' && !booking && !bookingError && <div className="muted" style={{ padding: '16px 0' }}>Loading…</div>}

      {tab === 'applicants' && booking && (
        <ApplicantsTab dealId={deal.id} applicants={booking.applicants} onChanged={loadBooking} />
      )}
      {tab === 'cost' && booking && (
        <CostSheetTab dealId={deal.id} costItems={booking.cost_items} totals={booking.totals} onChanged={loadBooking} />
      )}
      {tab === 'payments' && booking && (
        <PaymentsTab dealId={deal.id} milestones={booking.milestones} totals={booking.totals} onChanged={loadBooking} />
      )}
      {tab === 'documents' && booking && (
        <DocumentsTab dealId={deal.id} documents={booking.documents} onChanged={loadBooking} />
      )}
    </div>
  );
}
