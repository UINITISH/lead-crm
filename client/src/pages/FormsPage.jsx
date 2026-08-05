import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api, token } from '../lib/api.js';

const CLOSE_MS = 260; // matches the .side-panel transition duration in styles.css

const FIELD_TYPE_LABELS = {
  text: 'Text', email: 'Email', tel: 'Phone number', textarea: 'Paragraph',
  select: 'Dropdown', checkboxes: 'Checkboxes',
  budget: 'Budget (preset ranges)', project: 'Project (from your directory)',
};
// Types an admin can freely switch a CUSTOM field between. Core fields (first
// name, email, phone, budget, project, message) keep their fixed type — it's
// what makes their answers map onto the right lead column. 'tel' is included
// here too, separately from the core phone field, so an admin can add a
// second phone-style field (e.g. "Alternate number", "WhatsApp") if they want.
const CUSTOM_FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkboxes'];

const DEFAULT_FIELDS = () => ([
  { key: 'first_name', label: 'First name', type: 'text', required: true },
  { key: 'last_name', label: 'Last name', type: 'text', required: false },
  { key: 'phone', label: 'Phone', type: 'tel', required: true },
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

/** Opens a rendered HTML string in a new tab via a blob URL — used for both live-draft and saved-form previews. */
function openHtmlInNewTab(html) {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

/** Add/remove/edit the option list for a Dropdown or Checkboxes field. */
function OptionsEditor({ options, onChange }) {
  function setOption(i, value) {
    onChange(options.map((o, idx) => (idx === i ? value : o)));
  }
  function removeOption(i) {
    onChange(options.filter((_, idx) => idx !== i));
  }
  function addOption() {
    onChange([...options, '']);
  }
  return (
    <div style={{ marginTop: 8, paddingLeft: 4, borderLeft: '2px solid var(--line)' }}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6, paddingLeft: 8 }}>Options</div>
      {options.map((o, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, paddingLeft: 8 }}>
          <input value={o} placeholder={`Option ${i + 1}`} onChange={(e) => setOption(i, e.target.value)} style={{ flex: 1 }} />
          <button type="button" onClick={() => removeOption(i)} title="Remove option" style={{ padding: '4px 8px', color: 'var(--bad)' }}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <button type="button" onClick={addOption} style={{ marginLeft: 8, fontSize: 12, padding: '4px 8px' }}>
        <Icon name="plus" size={11} /> Add option
      </button>
    </div>
  );
}

/**
 * The one field an admin can drag anywhere but can't delete or make
 * optional — leads.phone_e164 is NOT NULL and dedupe depends on it, so the
 * backend (forms.js's sanitizeFields()) re-adds it if it's ever missing.
 * Rather than let that happen silently on save, just don't offer the
 * controls that would trigger it.
 */
function FieldRow({ field, index, onChange, onRemove, onDragStart, onDragOver, onDrop }) {
  const isCustom = field.key.startsWith('custom_');
  const isPhone = field.key === 'phone';
  const hasOptions = field.type === 'select' || field.type === 'checkboxes';
  // The whole row is the drag source/drop target (needed for onDragOver to
  // fire while another row passes over it), but only a press starting on the
  // grip handle actually initiates the drag — clicking into the label input
  // or a select shouldn't fight the browser's normal text-selection/drag.
  const dragAllowed = useRef(false);

  return (
    <div
      className="list-row"
      draggable
      onDragStart={(e) => {
        if (!dragAllowed.current) { e.preventDefault(); return; }
        onDragStart(index);
      }}
      onDragOver={(e) => { e.preventDefault(); onDragOver(index); }}
      onDrop={(e) => { e.preventDefault(); onDrop(); }}
      onDragEnd={() => { dragAllowed.current = false; }}
      style={{ alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}
    >
      <span
        onMouseDown={() => { dragAllowed.current = true; }}
        onMouseUp={() => { dragAllowed.current = false; }}
        title="Drag to reorder"
        style={{ cursor: 'grab', color: 'var(--muted)', padding: '8px 2px 0 0', touchAction: 'none' }}
      >
        <Icon name="grip-vertical" size={15} />
      </span>
      <div style={{ flex: 1, minWidth: 180 }}>
        <input value={field.label} placeholder="Field label"
               onChange={(e) => onChange({ ...field, label: e.target.value })}
               style={{ marginBottom: 4 }} />
        {isCustom ? (
          <select value={field.type} onChange={(e) => {
            const type = e.target.value;
            const next = { ...field, type };
            if ((type === 'select' || type === 'checkboxes') && !next.options) next.options = ['Option 1', 'Option 2'];
            onChange(next);
          }} style={{ fontSize: 12, padding: '4px 6px' }}>
            {CUSTOM_FIELD_TYPES.map((t) => <option key={t} value={t}>{FIELD_TYPE_LABELS[t]}</option>)}
          </select>
        ) : (
          <div className="muted" style={{ fontSize: 11 }}>{FIELD_TYPE_LABELS[field.type] || field.type} field</div>
        )}
        {hasOptions && (
          <OptionsEditor options={field.options || []} onChange={(options) => onChange({ ...field, options })} />
        )}
      </div>
      {isPhone ? (
        <span className="muted" style={{ fontSize: 12, marginTop: 8, whiteSpace: 'nowrap' }}>Always required</span>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 400, fontSize: 12, marginTop: 8, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={field.required} onChange={(e) => onChange({ ...field, required: e.target.checked })} />
          Required
        </label>
      )}
      {!isPhone && (
        <button type="button" onClick={onRemove} title="Remove field" style={{ marginTop: 4, color: 'var(--bad)', padding: '6px 8px' }}>
          <Icon name="trash-2" size={14} />
        </button>
      )}
    </div>
  );
}

/** Used for both creating a new form (no `form` prop) and editing an existing one. */
function FormBuilderPanel({ form, developers, onClose, onSaved }) {
  const [name, setName] = useState(form?.name || '');
  const [fields, setFields] = useState(form?.fields?.length ? form.fields : (form ? [] : DEFAULT_FIELDS()));
  const [developerName, setDeveloperName] = useState(form?.developer_name || '');
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [err, setErr] = useState(null);
  const dragFromRef = useRef(null);

  function updateField(i, next) {
    setFields((list) => list.map((f, idx) => (idx === i ? next : f)));
  }
  function removeField(i) {
    setFields((list) => list.filter((_, idx) => idx !== i));
  }
  function addField() {
    setFields((list) => [...list, newCustomField()]);
  }
  function moveField(from, to) {
    if (from === to) return;
    setFields((list) => {
      const next = [...list];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  function cleanedFields() {
    return fields.map((f) => ({ ...f, label: f.label.trim() })).filter((f) => f.label);
  }

  async function preview() {
    setPreviewing(true);
    try {
      const r = await fetch('/api/admin/forms/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
        body: JSON.stringify({ name: name.trim() || 'Untitled form', fields: cleanedFields(), developer_name: developerName || null }),
      });
      const html = await r.text();
      openHtmlInNewTab(html);
    } catch (e) {
      setErr('Could not build the preview: ' + e.message);
    }
    setPreviewing(false);
  }

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const payload = { name: name.trim(), fields: cleanedFields(), developer_name: developerName || null };
      if (form) {
        await api('/forms/' + form.id, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/forms', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    }
    setSaving(false);
  }

  return (
    <SidePanel title={form ? `Edit "${form.name}"` : 'New lead form'} onClose={onClose}>
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
            Drag the <Icon name="grip-vertical" size={11} /> handle to reorder fields. Phone number is always collected —
            it's how leads get matched and de-duplicated — so you can move it but not delete it or make it optional.
            Everything else is yours to edit: rename, mark required, delete, or add your own (including dropdowns and
            checkboxes with your own options).
          </p>
          {fields.map((f, i) => (
            <FieldRow
              key={f.key}
              field={f}
              index={i}
              onChange={(next) => updateField(i, next)}
              onRemove={() => removeField(i)}
              onDragStart={(idx) => { dragFromRef.current = idx; }}
              onDragOver={(idx) => {
                if (dragFromRef.current === null || dragFromRef.current === idx) return;
                moveField(dragFromRef.current, idx);
                dragFromRef.current = idx;
              }}
              onDrop={() => { dragFromRef.current = null; }}
            />
          ))}
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

          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <button type="button" onClick={preview} disabled={previewing}>
              {previewing ? 'Building preview…' : 'Preview'}
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" onClick={dismiss}>Cancel</button>
              <button type="submit" className="primary" disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : form ? 'Save changes' : 'Create form'}
              </button>
            </div>
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
  const [editingForm, setEditingForm] = useState(null);
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

  // Open the real, live URL directly — not a fetched-then-reconstructed blob
  // copy. A saved form is a normal server-rendered page with a real <form
  // action="/f/:id/submit">; navigating straight to it guarantees the submit
  // button posts to the actual endpoint. (Unsaved drafts still need the blob
  // trick, since there's no saved public_id to link to yet — see previewDraft.)
  function previewSaved(form) {
    window.open(embedUrl(form.public_id), '_blank');
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
            Fields: {(f.fields || []).map((x) => x.label).join(', ') || 'Phone'}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={() => previewSaved(f)}>Preview</button>
            <button onClick={() => setEditingForm(f)}><Icon name="edit-2" size={13} /> Edit</button>
            <button className="primary" onClick={() => setEmbedFor(f)}>Get embed code</button>
            <button onClick={() => toggleActive(f)}>{f.is_active ? 'Turn off' : 'Turn on'}</button>
            <button onClick={() => remove(f)} style={{ color: 'var(--bad)' }}>Delete</button>
          </div>
        </div>
      ))}

      {showNew && (
        <FormBuilderPanel developers={developers} onClose={() => setShowNew(false)}
                           onSaved={() => { setShowNew(false); load(); }} />
      )}
      {editingForm && (
        <FormBuilderPanel form={editingForm} developers={developers} onClose={() => setEditingForm(null)}
                           onSaved={() => { setEditingForm(null); load(); }} />
      )}
      {embedFor && <EmbedPanel form={embedFor} onClose={() => setEmbedFor(null)} />}
    </>
  );
}
