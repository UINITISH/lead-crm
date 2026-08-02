import { useState } from 'react';
import { api } from '../lib/api.js';

export default function FollowUpQuickAdd({ leadId, actingAs, onAdded }) {
  const [due, setDue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!due) return;
    setSaving(true);
    await api(`/leads/${leadId}/followups`, {
      method: 'POST',
      body: JSON.stringify({ due_at: new Date(due).toISOString(), note: note || null, actor: actingAs || 'admin' }),
    });
    setDue(''); setNote(''); setSaving(false);
    onAdded();
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input type="datetime-local" value={due} onChange={e => setDue(e.target.value)} style={{ flex: 1 }} required />
      <input placeholder="Note" value={note} onChange={e => setNote(e.target.value)} style={{ flex: 1 }} />
      <button type="submit" className="primary" disabled={saving}>{saving ? '…' : 'Add'}</button>
    </form>
  );
}
