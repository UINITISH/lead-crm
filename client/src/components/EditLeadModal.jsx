import { useState, useEffect, useRef } from 'react';
import { api } from '../lib/api.js';
import Icon from './Icon.jsx';
import DeveloperMultiSelect from './DeveloperMultiSelect.jsx';

const CLOSE_MS = 260; // matches the .side-panel transition duration in styles.css

/**
 * Edit an existing lead's business-facing fields. Slides in from the right
 * like the lead detail drawer, instead of a centered popup — no dark
 * backdrop, just click outside or Cancel/X to dismiss.
 */
export default function EditLeadModal({ lead, actingAs, onClose, onSaved }) {
  const [form, setForm] = useState({
    full_name: lead.full_name || '',
    email: lead.email || '',
    phone: lead.phone_e164 || '',
    source: lead.source || 'website',
    developer_name: lead.developer_name || '',
    project_name: lead.project_name || '',
    budget_range: lead.budget_range || '',
    budget_min: lead.budget_min ?? '',
    budget_max: lead.budget_max ?? '',
    timeline: lead.timeline || '',
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);

  // Slide in on mount — two rAFs so the browser paints the off-screen
  // position first, then transitions to on-screen (one rAF alone can get
  // batched into the same frame and skip the animation entirely).
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setOpen(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  /** Slide out, then unmount — `after` defaults to onClose (Cancel/X/outside click). */
  function dismiss(after = onClose) {
    setOpen(false);
    setTimeout(after, CLOSE_MS);
  }

  useEffect(() => {
    const onDocClick = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) dismiss();
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    try {
      await api('/leads/' + lead.id, {
        method: 'PATCH',
        body: JSON.stringify({
          full_name: form.full_name || null,
          email: form.email || null,
          phone: form.phone,
          source: form.source,
          developer_name: form.developer_name || null,
          project_name: form.project_name || null,
          budget_range: form.budget_range || null,
          budget_min: form.budget_min !== '' ? Number(form.budget_min) : null,
          budget_max: form.budget_max !== '' ? Number(form.budget_max) : null,
          timeline: form.timeline || null,
          actor: actingAs || 'admin',
        }),
      });
      dismiss(onSaved);
    } catch (e2) {
      setErr(e2.message);
      setSaving(false);
    }
  }

  return (
    <div className={'side-panel' + (open ? ' open' : '')} ref={panelRef} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Edit lead</h1>
        <div className="grow" />
        <button onClick={() => dismiss()}><Icon name="x" size={14} /></button>
      </div>

      <form onSubmit={save}>
        {err && <div className="form-error" style={{ marginTop: 16 }}>{err}</div>}

        <h2>Contact</h2>
        <div className="row2">
          <div className="field">
            <label>Full name</label>
            <input value={form.full_name} onChange={set('full_name')} />
          </div>
          <div className="field">
            <label>Email</label>
            <input value={form.email} onChange={set('email')} />
          </div>
        </div>
        <div className="row2">
          <div className="field">
            <label>Phone</label>
            <input value={form.phone} onChange={set('phone')} placeholder="98765 43210" />
          </div>
          <div className="field">
            <label>Source</label>
            <select value={form.source} disabled title="Source is set when the lead comes in and can't be changed">
              <option value="meta">Meta (Facebook/Instagram)</option>
              <option value="google">Google</option>
              <option value="website">Website</option>
            </select>
          </div>
        </div>

        <h2>Interest</h2>
        <div className="field">
          <label>Developer(s)</label>
          <DeveloperMultiSelect
            initialNames={(lead.developer_name || '').split(',').map((s) => s.trim()).filter(Boolean)}
            onChange={({ names }) => setForm((f) => ({ ...f, developer_name: names.join(', ') }))}
          />
        </div>
        <div className="field">
          <label>Project / location</label>
          <input value={form.project_name} onChange={set('project_name')} />
        </div>

        <h2>Budget & timeline</h2>
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
            <input type="number" value={form.budget_min} onChange={set('budget_min')} />
          </div>
          <div className="field">
            <label>Budget max (₹ lakhs)</label>
            <input type="number" value={form.budget_max} onChange={set('budget_max')} />
          </div>
        </div>

        <div className="modal-actions">
          <button type="button" onClick={() => dismiss()}>Cancel</button>
          <button type="submit" className="primary" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </div>
  );
}
