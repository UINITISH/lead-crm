import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { NEW } from '../constants.js';
import DeveloperMultiSelect from './DeveloperMultiSelect.jsx';

/**
 * Manual lead entry. Covers two real cases: a call-in logged by hand, and a
 * Meta/Google lead downloaded as a CSV from the ads dashboard and typed in
 * rather than arriving over the webhook — which is why source is a field the
 * person fills in themselves rather than something inferred.
 */
export default function AddLeadModal({ onClose, onSaved }) {
  const [projects, setProjects] = useState([]);
  const [devSelection, setDevSelection] = useState({ names: [], ids: [] });
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', budget_range: '', budget_min: '', budget_max: '', timeline: '',
    source: 'meta',
    project_id: '', project_new: '', project_text: '', notes: '',
    actor: sessionStorage.getItem('crm_actor') || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  // A project dropdown only makes sense when there's exactly one unambiguous,
  // known developer selected — with multiple developers (or a freeform one),
  // a single project link doesn't apply, so it falls back to a plain text field.
  const singleKnownDevId = devSelection.ids.length === 1 && devSelection.names.length === 1
    ? devSelection.ids[0] : null;

  useEffect(() => {
    if (!singleKnownDevId) { setProjects([]); return; }
    api('/projects?developer_id=' + singleKnownDevId).then(r => setProjects(r.projects || [])).catch(() => {});
  }, [singleKnownDevId]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    setErr(null);

    if (!form.phone.trim()) { setErr('Phone number is required.'); return; }
    if (form.project_id === NEW && !form.project_new.trim()) { setErr('Enter the new project’s name.'); return; }

    const payload = {
      full_name: form.full_name || null,
      phone: form.phone,
      email: form.email || null,
      budget_range: form.budget_range || null,
      budget_min: form.budget_min !== '' ? Number(form.budget_min) : null,
      budget_max: form.budget_max !== '' ? Number(form.budget_max) : null,
      timeline: form.timeline || null,
      source: form.source,
      notes: form.notes || null,
      actor: form.actor || 'admin',
    };

    if (singleKnownDevId) {
      payload.developer_id = singleKnownDevId;
    } else if (devSelection.names.length > 0) {
      payload.developer_name = devSelection.names.join(', ');
    }

    if (singleKnownDevId) {
      if (form.project_id === NEW) payload.project_name = form.project_new;
      else if (form.project_id) payload.project_id = form.project_id;
    } else if (form.project_text.trim()) {
      payload.project_name = form.project_text.trim();
    }

    setSaving(true);
    try {
      const r = await api('/leads/manual', { method: 'POST', body: JSON.stringify(payload) });
      if (!r.ok) { setErr(r.error || 'Could not save lead.'); setSaving(false); return; }
      if (form.actor) sessionStorage.setItem('crm_actor', form.actor);
      onSaved(r);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h1>Add lead manually</h1>
        <p className="muted" style={{ marginTop: 0, fontSize: 12 }}>
          For call-ins, walk-ins, or leads downloaded from Meta/Google and typed in by hand.
        </p>

        <form onSubmit={submit}>
          {err && <div className="form-error">{err}</div>}

          <div className="row2">
            <div className="field">
              <label>Full name</label>
              <input value={form.full_name} onChange={set('full_name')} placeholder="Anita Desai" />
            </div>
            <div className="field">
              <label>Phone *</label>
              <input value={form.phone} onChange={set('phone')} placeholder="98765 43210" required />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>Email</label>
              <input value={form.email} onChange={set('email')} placeholder="name@example.com" />
            </div>
            <div className="field">
              <label>Source *</label>
              <select value={form.source} onChange={set('source')}>
                <option value="meta">Meta (Facebook/Instagram)</option>
                <option value="google">Google</option>
                <option value="website">Website</option>
              </select>
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>Budget (as told to you)</label>
              <input value={form.budget_range} onChange={set('budget_range')} placeholder="1.5-2 Cr" />
            </div>
            <div className="field">
              <label>Timeline</label>
              <input value={form.timeline} onChange={set('timeline')} placeholder="within 3 months" />
            </div>
          </div>

          <div className="row2">
            <div className="field">
              <label>Budget min (₹ lakhs)</label>
              <input type="number" value={form.budget_min} onChange={set('budget_min')} placeholder="150" />
            </div>
            <div className="field">
              <label>Budget max (₹ lakhs)</label>
              <input type="number" value={form.budget_max} onChange={set('budget_max')} placeholder="200" />
            </div>
          </div>
          <p className="muted" style={{ marginTop: -8, fontSize: 11 }}>
            Optional, powers the dashboard's pipeline value. 150 = ₹1.5 Cr.
          </p>

          <div className="field">
            <label>Developer(s)</label>
            <DeveloperMultiSelect initialNames={[]} onChange={setDevSelection} />
          </div>

          {singleKnownDevId ? (
            <div className="field">
              <label>Project</label>
              <select value={form.project_id} onChange={set('project_id')}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value={NEW}>+ Add new project…</option>
              </select>
              {form.project_id === NEW && (
                <input style={{ marginTop: 8 }} value={form.project_new} onChange={set('project_new')} placeholder="e.g. Casagrand Utopia" />
              )}
            </div>
          ) : (
            <div className="field">
              <label>Project / location</label>
              <input value={form.project_text} onChange={set('project_text')} placeholder="e.g. Whitefield, or a specific project name" />
              <p className="muted" style={{ margin: '5px 0 0', fontSize: 11 }}>
                Free text — a specific project link only applies when exactly one known developer is selected above.
              </p>
            </div>
          )}

          <div className="field">
            <label>Notes</label>
            <textarea value={form.notes} onChange={set('notes')} placeholder="Any context worth keeping" />
          </div>

          <div className="field">
            <label>Entered by</label>
            <input value={form.actor} onChange={set('actor')} placeholder="Your name" />
          </div>

          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save lead'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
