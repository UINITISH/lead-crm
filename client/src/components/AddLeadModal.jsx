import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { NEW } from '../constants.js';

/**
 * Manual lead entry. Covers two real cases: a call-in logged by hand, and a
 * Meta/Google lead downloaded as a CSV from the ads dashboard and typed in
 * rather than arriving over the webhook — which is why source is a field the
 * person fills in themselves rather than something inferred.
 */
export default function AddLeadModal({ onClose, onSaved }) {
  const [devs, setDevs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [form, setForm] = useState({
    full_name: '', phone: '', email: '', budget_range: '', budget_min: '', budget_max: '', timeline: '',
    source: 'meta', developer_id: '', developer_new: '', developer_grade: '',
    project_id: '', project_new: '', notes: '',
    actor: sessionStorage.getItem('crm_actor') || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => { api('/developers').then(r => setDevs(r.developers || [])).catch(() => {}); }, []);

  useEffect(() => {
    if (!form.developer_id || form.developer_id === NEW) { setProjects([]); return; }
    api('/projects?developer_id=' + form.developer_id).then(r => setProjects(r.projects || [])).catch(() => {});
  }, [form.developer_id]);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const gradeA = devs.filter(d => d.grade === 'A');
  const gradeB = devs.filter(d => d.grade === 'B');
  const gradeOther = devs.filter(d => !d.grade);

  async function submit(e) {
    e.preventDefault();
    setErr(null);

    if (!form.phone.trim()) { setErr('Phone number is required.'); return; }
    if (form.developer_id === NEW && !form.developer_new.trim()) { setErr('Enter the new developer’s name.'); return; }
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
    if (form.developer_id === NEW) {
      payload.developer_name = form.developer_new;
      payload.developer_grade = form.developer_grade || null;
    } else if (form.developer_id) {
      payload.developer_id = form.developer_id;
    }
    if (form.project_id === NEW) {
      payload.project_name = form.project_new;
    } else if (form.project_id) {
      payload.project_id = form.project_id;
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

          <div className="row2">
            <div className="field">
              <label>Developer</label>
              <select value={form.developer_id} onChange={set('developer_id')}>
                <option value="">— Select developer —</option>
                {gradeA.length > 0 && (
                  <optgroup label="A-Grade">
                    {gradeA.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                )}
                {gradeB.length > 0 && (
                  <optgroup label="B-Grade">
                    {gradeB.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                )}
                {gradeOther.length > 0 && (
                  <optgroup label="Other">
                    {gradeOther.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </optgroup>
                )}
                <option value={NEW}>+ Add new developer…</option>
              </select>
            </div>
            <div className="field">
              <label>Project</label>
              <select value={form.project_id} onChange={set('project_id')}
                      disabled={!form.developer_id}>
                <option value="">— Select project —</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value={NEW}>+ Add new project…</option>
              </select>
            </div>
          </div>

          {form.developer_id === NEW && (
            <div className="row2">
              <div className="field">
                <label>New developer name *</label>
                <input value={form.developer_new} onChange={set('developer_new')} placeholder="e.g. Casagrand" />
              </div>
              <div className="field">
                <label>Grade</label>
                <select value={form.developer_grade} onChange={set('developer_grade')}>
                  <option value="">Unknown</option>
                  <option value="A">A-Grade</option>
                  <option value="B">B-Grade</option>
                </select>
              </div>
            </div>
          )}

          {form.project_id === NEW && (
            <div className="field">
              <label>New project name *</label>
              <input value={form.project_new} onChange={set('project_new')} placeholder="e.g. Casagrand Utopia" />
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
