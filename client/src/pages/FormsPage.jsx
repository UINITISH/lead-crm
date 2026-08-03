import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';

const FIELD_OPTIONS = [
  { key: 'show_email', label: 'Email' },
  { key: 'show_budget', label: 'Budget range' },
  { key: 'show_project', label: 'Which project interested in' },
  { key: 'show_message', label: 'Message / notes' },
];

function embedUrl(publicId) {
  return window.location.origin + '/f/' + publicId;
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <h1>Embed "{form.name}"</h1>
        <p className="muted" style={{ fontSize: 13, marginTop: -6 }}>
          Paste this into a WordPress "Custom HTML" block (or any page's HTML) wherever you want the form to appear.
          Submissions land directly in your Leads list, tagged source: website.
        </p>
        <textarea readOnly value={snippet} rows={4}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 12.5, marginTop: 8 }}
                  onClick={e => e.target.select()} />
        <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
          <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, alignSelf: 'center' }}>Preview form ↗</a>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose}>Close</button>
            <button className="primary" onClick={copy}>{copied ? 'Copied!' : 'Copy code'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function NewFormPanel({ developers, onClose, onSaved }) {
  const [name, setName] = useState('');
  const [fields, setFields] = useState({ show_email: true, show_budget: true, show_project: true, show_message: true });
  const [developerName, setDeveloperName] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      await api('/forms', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), ...fields, developer_name: developerName || null }),
      });
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    }
    setSaving(false);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h1>New lead form</h1>
        <form onSubmit={submit}>
          {err && <div className="err" style={{ color: 'var(--bad)', fontSize: 12.5, marginBottom: 10 }}>{err}</div>}
          <div className="field">
            <label>Form name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Homepage contact form" required />
          </div>
          <div className="field">
            <label>Fields to collect (name &amp; phone are always included)</label>
            {FIELD_OPTIONS.map(f => (
              <label key={f.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 400, fontSize: 13, margin: '6px 0' }}>
                <input type="checkbox" checked={fields[f.key]}
                       onChange={e => setFields(s => ({ ...s, [f.key]: e.target.checked }))} />
                {f.label}
              </label>
            ))}
          </div>
          {fields.show_project && (
            <div className="field">
              <label>Pin the project dropdown to one developer (optional)</label>
              <select value={developerName} onChange={e => setDeveloperName(e.target.value)}>
                <option value="">All developers</option>
                {developers.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div className="modal-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="primary" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Create form'}</button>
          </div>
        </form>
      </div>
    </div>
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

      {!loading && forms.map(f => (
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
