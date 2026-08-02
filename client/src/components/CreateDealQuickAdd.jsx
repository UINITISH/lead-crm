import { useState } from 'react';
import { api } from '../lib/api.js';

export default function CreateDealQuickAdd({ leadId, actingAs, onCreated }) {
  const [form, setForm] = useState({ unit_number: '', agreed_price: '', expected_closing_date: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    const r = await api(`/leads/${leadId}/deals`, {
      method: 'POST',
      body: JSON.stringify({
        unit_number: form.unit_number || null,
        agreed_price: form.agreed_price !== '' ? Number(form.agreed_price) : null,
        expected_closing_date: form.expected_closing_date || null,
        notes: form.notes || null,
        actor: actingAs || 'admin',
      }),
    });
    setSaving(false);
    if (!r.ok) { setErr(r.error); return; }
    onCreated();
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 8 }}>
      {err && <div className="form-error">{err}</div>}
      <div className="row2">
        <input placeholder="Unit / flat number" value={form.unit_number} onChange={set('unit_number')} />
        <input type="number" placeholder="Agreed price (₹ L)" value={form.agreed_price} onChange={set('agreed_price')} />
      </div>
      <div className="row2" style={{ marginTop: 8 }}>
        <input type="date" value={form.expected_closing_date} onChange={set('expected_closing_date')} />
        <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Open deal'}</button>
      </div>
    </form>
  );
}
