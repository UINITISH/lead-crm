import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';

const CLOSE_MS = 260; // matches the .side-panel transition duration in styles.css

const DEFAULT_FIELDS = () => ([
  { key: 'first_name', label: 'First name', type: 'text', required: true },
  { key: 'last_name', label: 'Last name', type: 'text', required: false },
  { key: 'email', label: 'Email', type: 'email', required: false },
  { key: 'budget', label: 'Budget', type: 'budget', required: false },
  { key: 'project', label: 'Which project interested in', type: 'project', required: false },
  { key: 'message', label: 'Message / notes', type: 'textarea', required: false },
]);

function newCustomField() {
  return { key: 'custom_' + Date.now().toString(36) + Math.floor(Math.random() * 1000), label: '', type: 'text', required: false };
}

function embedUrl(publicId) {
  return window.location.origin + '/f/' + publicId;
}

/** Shared shell for both side panels — slides in from the right, no dark backdrop, click-outside to dismiss. */
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

function EmbedPanel({ form, onClose }) {
  const [copied, setCopied] = useState(false);
  const url = embedUrl(form.public_id);
  const snippet = `<iframe src="${url}" style="width:100%; max-width:480px; height:640px; border:none;" title="${form.name.replace(/"/g, '&quot;')}"></iframe>`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can still select the text manually */ }
  }

  return (
    <SidePanel title={`Embed "${form.name}"`} onClose={onClose}>
      {(dismiss) => (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Paste this into a WordPress "Custom HTML" block (or any page's HTML) wherever you want the form to appear.
            Submissions land directly in your Leads list, tagged source: website.
          </p>
          <textarea readOnly value={snippet} rows={5}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5 }}
                    onClick={(e) => e.target.select()} />
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, alignSelf: 'center' }}>Preview form ↗</a>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={dismiss}>Close</button>
              <button className="primary" onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</button>
            </div>
          </div>
        </>
      )}
    </SidePanel>
  );
}

function FieldRow({ field, onChange, onRemove }) {
  return (
    <div className="list-row" style={{ alignItems: 'flex-start', gap: 10 }}>
      <div style={{ flex: 1 }}>
        <input value={field.label} placeholder="Field label"
               onChange={(e) => onChange({ ...field, label: e.target.value })}
               style={{ marginBottom: 4 }} />
        <div className="muted" style={{ fontSize: 11, textTransform: 'capitalize' }}>{field.type.replace('_', ' ')} field</div>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12, marginTop: 8, whiteSpace: 'nowrap' }}>
        <input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
        Required
      </label>
      <button type="button" onClick={onRemove} title="Remove field" style={{ marginTop: 4, color: 'var(--bad)', padding: '6px 8px' }}>
        <Icon name="trash-2" size={14} />
      </button>
    </div>
  );
}

function NewFormPanel({ developers, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [fields, setFields] = useState(DEFAULT_FIELDS);
  const [developerName, setDeveloperName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  function updateField(i, next) {
    setFields((list) => list.map((f, idx) => (idx === i ? next : f)));
  }
  function removeField(i) {
    setFields((list) => list.filter((_, idx) => idx !== i));
  }
  function addField() {
    setFields((list) => [...list, newCustomField()]);
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const cleanFields = fields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label);
      await api('/forms', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), fields: cleanFields, developer_name: developerName || null }),
      });
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    }
    setSaving(false);
  }

  return (
    <SidePanel title="New lead form" onClose={onClose}>
      {(dismiss) => (
        <form onSubmit={submit}>
          {err && <div className="form-error" style={{ marginTop: 16 }}>{err}</div>}

          <h2>Basics</h2>
          <div className="field">
            <label>Form name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Homepage contact form" required />
          </div>

          <h2>Fields</h2>
          <p className="muted" style={{ marginTop: -8, marginBottom: 10, fontSize: 12 }}>
            Phone number is always collected — it's how leads get matched and de-duplicated. Everything else below is
            yours to edit: rename, mark required, delete, or add your own.
          </p>
          {fields.map((f, i) => (
            <FieldRow key={f.key} field={f} onChange={(next) => updateField(i, next)} onRemove={() => removeField(i)} />
          ))}
          {!fields.length && <div className="muted" style={{ fontSize: 12, padding: '8px 0' }}>No extra fields — just phone number.</div>}
          <button type="button" onClick={addField} style={{ marginTop: 8 }}>
            <Icon name="plus" size={13} /> Add field
          </button>

          {fields.some((f) => f.key === 'project') && (
            <>
              <h2>Project dropdown</h2>
              <div className="field">
                <label>Pin it to one developer (optional)</label>
                <select value={developerName} onChange={(e) => setDeveloperName(e.target.value)}>
                  <option value="">All developers</option>
                  {developers.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
              </div>
            </>
          )}

          <div className="modal-actions">
            <button type="button" onClick={dismiss}>Cancel</button>
            <button type="submit" className="primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Create form'}</button>
          </div>
        </form>
      )}
    </SidePanel>
  );
}

export default function FormsPage() {
  const [forms, setForms] = useState([]);
  const [developers, setDevelopers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [embedFor, setEmbedFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [f, d] = await Promise.all([api('/forms'), api('/developers')]);
      setForms(f.forms || []);
      setDevelopers(d.developers || []);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggleActive(form) {
    await api('/forms/' + form.id, { method: 'PATCH', body: JSON.stringify({ is_active: !form.is_active }) });
    load();
  }

  async function remove(form) {
    if (!window.confirm(`Delete "${form.name}"? Its embed link will stop accepting submissions. Leads already captured stay in your Leads list.`)) return;
    await api('/forms/' + form.id, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <div className="topbar">
        <h1>Lead forms</h1>
        <div className="grow" />
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
        <button className="primary" onClick={() => setShowNew(true)}><Icon name="plus" size={14} /> New form</button>
      </div>

      <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: 13 }}>
        Build a lead-capture form here, then embed it on your WordPress site (or anywhere else) as an iframe.
        Every submission lands directly in Leads with source: website — no plugin, no Zapier, nothing to configure on WordPress.
      </p>

      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}

      {loading && <div className="empty">Loading…</div>}

      {!loading && !forms.length && (
        <div className="card">No forms yet — click "New form" to create your first one.</div>
      )}

      {!loading && forms.map((f) => (
        <div className="card" key={f.id} style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 600, flex: 1 }}>{f.name}</span>
            <span className={'pill ' + (f.is_active ? 'st-closed' : 'st-dropped')}>
              {f.is_active ? 'Active' : 'Inactive'}
            </span>
            <span className="muted" style={{ fontSize: 12 }}>
              {f.submission_count} lead{f.submission_count === 1 ? '' : 's'}
            </span>
          </div>
          {f.developer_name && (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Pinned to: {f.developer_name}</div>
          )}
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            Fields: Phone{(f.fields || []).length ? ', ' + f.fields.map((x) => x.label).join(', ') : ''}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="primary" onClick={() => setEmbedFor(f)}>Get embed code</button>
            <button onClick={() => toggleActive(f)}>{f.is_active ? 'Turn off' : 'Turn on'}</button>
            <button onClick={() => remove(f)} style={{ color: 'var(--bad)' }}>Delete</button>
          </div>
        </div>
      ))}

      {showNew && (
        <NewFormPanel developers={developers} onClose={() => setShowNew(false)}
                      onSaved={() => { setShowNew(false); load(); }} />
      )}
      {embedFor && <EmbedPanel form={embedFor} onClose={() => setEmbedFor(null)} />}
    </>
  );
}
