import { useState } from 'react';
import { api } from '../lib/api.js';
import { DEAL_STAGES, DEAL_STAGE_LABELS } from '../constants.js';

export default function DealEditModal({ deal, onClose, onSaved, actingAs }) {
  const [form, setForm] = useState({
    unit_number: deal.unit_number || '',
    agreed_price: deal.agreed_price ?? '',
    expected_closing_date: deal.expected_closing_date ? deal.expected_closing_date.slice(0, 10) : '',
    notes: deal.notes || '',
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

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

  async function changeStage(stage) {
    await api('/deals/' + deal.id, { method: 'PATCH', body: JSON.stringify({ stage, actor: actingAs || 'admin' }) });
    onSaved();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h1>{deal.full_name || 'Deal'}</h1>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>{deal.developer_name} {deal.project_name ? '· ' + deal.project_name : ''}</p>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '12px 0 18px' }}>
          {DEAL_STAGES.map(s => (
            <button key={s} className={deal.stage === s ? 'primary' : ''} onClick={() => changeStage(s)}>
              {DEAL_STAGE_LABELS[s]}
            </button>
          ))}
        </div>

        <form onSubmit={save}>
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
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Close</button>
            <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
