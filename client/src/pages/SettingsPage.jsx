import { useState, useEffect } from 'react';
import IntegrationCard from '../components/IntegrationCard.jsx';
import CopyField from '../components/CopyField.jsx';
import { api } from '../lib/api.js';

export default function SettingsPage() {
  const [integrations, setIntegrations] = useState(null);
  const [settings, setSettings] = useState(null);
  const [stats, setStats] = useState(null);
  const [reps, setReps] = useState([]);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);

  const [companyName, setCompanyName] = useState('');
  const [dedupeDays, setDedupeDays] = useState('30');
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState(null);

  const [newRep, setNewRep] = useState('');
  const [newRepEmail, setNewRepEmail] = useState('');
  const [savingRep, setSavingRep] = useState(false);

  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [newTagColor, setNewTagColor] = useState('gray');
  const [savingTag, setSavingTag] = useState(false);
  const TAG_COLORS = ['orange', 'blue', 'gray', 'red', 'green', 'purple'];

  const [wiping, setWiping] = useState(false);
  const [reseeding, setReseeding] = useState(false);
  const [dataMsg, setDataMsg] = useState(null);

  async function loadAll() {
    setLoading(true);
    try {
      const [i, s, d, r, t] = await Promise.all([
        api('/integration-status'), api('/settings'), api('/data-stats'), api('/reps'), api('/tags'),
      ]);
      setIntegrations(i.integrations);
      setSettings(s.settings);
      setCompanyName(s.settings.company_name || '');
      setDedupeDays(String(s.settings.dedupe_window_days ?? '30'));
      setStats(d.stats);
      setReps(r.reps || []);
      setTags(t.tags || []);
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  function changeToken() {
    localStorage.removeItem('crm_token');
    window.location.reload();
  }

  async function saveAppSettings(e) {
    e.preventDefault();
    setSavingSettings(true);
    setSettingsMsg(null);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({ company_name: companyName, dedupe_window_days: Number(dedupeDays) }),
      });
      setSettingsMsg({ ok: true, text: 'Saved.' });
      window.dispatchEvent(new Event('crm-settings-changed'));
    } catch (e) { setSettingsMsg({ ok: false, text: e.message }); }
    setSavingSettings(false);
  }

  async function addRep(e) {
    e.preventDefault();
    if (!newRep.trim()) return;
    setSavingRep(true);
    try {
      await api('/reps', { method: 'POST', body: JSON.stringify({ name: newRep.trim(), email: newRepEmail.trim() || undefined }) });
      setNewRep('');
      setNewRepEmail('');
      const r = await api('/reps');
      setReps(r.reps || []);
    } catch (e) { setLoadError(e.message); }
    setSavingRep(false);
  }

  async function toggleRep(rep) {
    try {
      await api('/reps/' + rep.id, { method: 'PATCH', body: JSON.stringify({ is_active: !rep.is_active }) });
      setReps(reps.map(r => r.id === rep.id ? { ...r, is_active: !rep.is_active } : r));
    } catch (e) { setLoadError(e.message); }
  }

  // Email is used to pick this rep on the Leads page's "Assigned" column —
  // saved on blur rather than a separate Save button, same lightweight
  // pattern the rest of this page uses for inline edits.
  async function updateRepEmail(rep, rawEmail) {
    const clean = rawEmail.trim();
    if (clean === (rep.email || '')) return;
    try {
      const r = await api('/reps/' + rep.id, { method: 'PATCH', body: JSON.stringify({ email: clean || null }) });
      if (!r.ok) { setLoadError(r.error); return; }
      setReps(prev => prev.map(x => x.id === rep.id ? r.rep : x));
    } catch (e) { setLoadError(e.message); }
  }

  async function addTag(e) {
    e.preventDefault();
    if (!newTag.trim()) return;
    setSavingTag(true);
    try {
      await api('/tags', { method: 'POST', body: JSON.stringify({ name: newTag.trim(), color: newTagColor }) });
      setNewTag('');
      setNewTagColor('gray');
      const t = await api('/tags');
      setTags(t.tags || []);
      window.dispatchEvent(new Event('crm-settings-changed'));
    } catch (e) { setLoadError(e.message); }
    setSavingTag(false);
  }

  async function toggleTag(tag) {
    try {
      await api('/tags/' + tag.id, { method: 'PATCH', body: JSON.stringify({ is_active: !tag.is_active }) });
      setTags(tags.map(t => t.id === tag.id ? { ...t, is_active: !tag.is_active } : t));
      window.dispatchEvent(new Event('crm-settings-changed'));
    } catch (e) { setLoadError(e.message); }
  }

  async function recolorTag(tag, color) {
    try {
      await api('/tags/' + tag.id, { method: 'PATCH', body: JSON.stringify({ color }) });
      setTags(tags.map(t => t.id === tag.id ? { ...t, color } : t));
      window.dispatchEvent(new Event('crm-settings-changed'));
    } catch (e) { setLoadError(e.message); }
  }

  async function wipeTestLeads() {
    if (!window.confirm('Delete every lead flagged as a test lead? This cannot be undone.')) return;
    setWiping(true);
    setDataMsg(null);
    try {
      const r = await api('/data/wipe-test-leads', { method: 'POST' });
      setDataMsg({ ok: true, text: `Deleted ${r.deleted} test lead${r.deleted === 1 ? '' : 's'}.` });
      const d = await api('/data-stats');
      setStats(d.stats);
    } catch (e) { setDataMsg({ ok: false, text: e.message }); }
    setWiping(false);
  }

  async function reseedDevelopers() {
    setReseeding(true);
    setDataMsg(null);
    try {
      const r = await api('/data/reseed-developers', { method: 'POST' });
      setDataMsg({
        ok: true,
        text: r.skipped
          ? 'Directory already has developers — nothing to do. (It only seeds an empty table, so existing data is never overwritten.)'
          : `Seeded ${r.developers} developers and ${r.projects} projects.`,
      });
      const d = await api('/data-stats');
      setStats(d.stats);
    } catch (e) { setDataMsg({ ok: false, text: e.message }); }
    setReseeding(false);
  }

  if (loading) return (<><div className="topbar"><h1>Settings</h1></div><p className="muted">Loading…</p></>);
  if (loadError) return (<><div className="topbar"><h1>Settings</h1></div><div className="form-error">{loadError}</div></>);

  const statLabels = [
    ['leads', 'Leads'], ['test_leads', 'Test leads'], ['developers', 'Developers'],
    ['projects', 'Projects'], ['deals', 'Deals'], ['follow_ups', 'Follow-ups'], ['ingest_log_rows', 'Ingest log rows'],
  ];

  return (
    <>
      <div className="topbar"><h1>Settings</h1></div>

      <h2>Integrations</h2>
      <IntegrationCard title="Website" configured={integrations.website.configured} webhookUrl={integrations.website.webhook_url}>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          POST leads here with a shared secret (WEBSITE_INGEST_SECRET in .env).
        </p>
      </IntegrationCard>
      <IntegrationCard title="Google Ads" configured={integrations.google.configured} webhookUrl={integrations.google.webhook_url}>
        <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>
          Paste this URL into the lead form asset's "Webhook integration" section, along with the key set as
          GOOGLE_WEBHOOK_KEY in .env.
        </p>
      </IntegrationCard>
      <IntegrationCard title="Meta Lead Ads" configured={integrations.meta.configured} webhookUrl={integrations.meta.webhook_url}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
          <span className={'pill ' + (integrations.meta.verify_token_set ? 'st-closed' : 'st-dropped')}>
            META_VERIFY_TOKEN {integrations.meta.verify_token_set ? 'set' : 'missing'}
          </span>
          <span className={'pill ' + (integrations.meta.app_secret_set ? 'st-closed' : 'st-dropped')}>
            META_APP_SECRET {integrations.meta.app_secret_set ? 'set' : 'missing'}
          </span>
          <span className={'pill ' + (integrations.meta.page_access_token_set ? 'st-closed' : 'st-dropped')}>
            META_PAGE_ACCESS_TOKEN {integrations.meta.page_access_token_set ? 'set' : 'missing'}
          </span>
        </div>
        <p className="muted" style={{ margin: '0', fontSize: 12 }}>
          Use this URL for the app review handshake (Meta calls it with hub.mode/hub.verify_token/hub.challenge)
          and as the leadgen webhook once subscribed via the Graph API.
        </p>
      </IntegrationCard>
      <div className="card" style={{ marginBottom: 24 }}>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4,
                        textTransform: 'uppercase', letterSpacing: .4 }}>Health check</label>
        <CopyField value={integrations.healthz_url} />
      </div>

      <h2>App behavior</h2>
      <form className="card" style={{ marginBottom: 24 }} onSubmit={saveAppSettings}>
        <div className="row2">
          <div className="field">
            <label>Company name</label>
            <input value={companyName} onChange={e => setCompanyName(e.target.value)} />
          </div>
          <div className="field">
            <label>Duplicate-lead window (days)</label>
            <input type="number" min="1" value={dedupeDays} onChange={e => setDedupeDays(e.target.value)} />
          </div>
        </div>
        <p className="muted" style={{ margin: '-6px 0 14px', fontSize: 12 }}>
          A repeat submission from the same phone number within this many days is flagged as a duplicate instead of a new lead.
        </p>
        {settingsMsg && <p style={{ color: settingsMsg.ok ? 'var(--good)' : 'var(--bad)', fontSize: 13, margin: '0 0 10px' }}>{settingsMsg.text}</p>}
        <button className="primary" type="submit" disabled={savingSettings}>{savingSettings ? 'Saving…' : 'Save'}</button>
      </form>

      <h2>Team</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          The shared list "Acting as" picks from in the sidebar, so activity and the leaderboard attribute
          consistently instead of depending on how someone happens to type their name. A rep's email is optional,
          but only reps with one set can be picked in the Leads table's "Assigned" column.
        </p>
        {reps.length === 0 ? (
          <p className="muted" style={{ margin: '0 0 12px' }}>No reps yet — add the first one below.</p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {reps.map(r => (
              <div key={r.id} className="list-row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <span style={{ flex: '0 0 auto' }}>{r.name}</span>
                <input type="email" defaultValue={r.email || ''} placeholder="email (for assignment)"
                       onBlur={e => updateRepEmail(r, e.target.value)}
                       style={{ flex: 1, fontSize: 12, padding: '5px 8px' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', flex: '0 0 auto' }}>
                  <input type="checkbox" checked={r.is_active} onChange={() => toggleRep(r)} />
                  Active
                </label>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addRep} style={{ display: 'flex', gap: 8 }}>
          <input value={newRep} onChange={e => setNewRep(e.target.value)} placeholder="Rep name" style={{ flex: 1 }} />
          <input type="email" value={newRepEmail} onChange={e => setNewRepEmail(e.target.value)} placeholder="Email (optional)" style={{ flex: 1 }} />
          <button className="primary" type="submit" disabled={savingRep || !newRep.trim()}>Add rep</button>
        </form>
      </div>

      <h2>Lead tags</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <p className="muted" style={{ margin: '0 0 12px' }}>
          A separate, informational label a rep can set on any lead — Warm, Cold, Junk, Scheduled, or anything else
          you add here. Independent of the pipeline status above it: a lead can be "new" and "warm" at the same time.
        </p>
        {tags.length === 0 ? (
          <p className="muted" style={{ margin: '0 0 12px' }}>No tags yet — add the first one below.</p>
        ) : (
          <div style={{ marginBottom: 14 }}>
            {tags.map(t => (
              <div key={t.id} className="list-row" style={{ justifyContent: 'space-between' }}>
                <span className={'pill tag-' + t.color}>{t.name}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <select value={t.color} onChange={e => recolorTag(t, e.target.value)} style={{ fontSize: 12, padding: '4px 6px' }}>
                    {TAG_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
                    <input type="checkbox" checked={t.is_active} onChange={() => toggleTag(t)} />
                    Active
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
        <form onSubmit={addTag} style={{ display: 'flex', gap: 8 }}>
          <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="Tag name (e.g. VIP)" style={{ flex: 1 }} />
          <select value={newTagColor} onChange={e => setNewTagColor(e.target.value)}>
            {TAG_COLORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <button className="primary" type="submit" disabled={savingTag || !newTag.trim()}>Add tag</button>
        </form>
      </div>

      <h2>Data management</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="cards" style={{ marginBottom: 16 }}>
          {statLabels.map(([key, label]) => (
            <div className="card" key={key}>
              <div className="n">{stats[key]}</div>
              <div className="l">{label}</div>
            </div>
          ))}
          <div className="card">
            <div className="n" style={{ fontSize: 15 }}>{stats.db_kind === 'postgres' ? 'Postgres' : 'PGlite (local)'}</div>
            <div className="l">Database backend</div>
          </div>
        </div>
        {dataMsg && <p style={{ color: dataMsg.ok ? 'var(--good)' : 'var(--bad)', fontSize: 13, margin: '0 0 12px' }}>{dataMsg.text}</p>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={wipeTestLeads} disabled={wiping}>{wiping ? 'Deleting…' : `Wipe test leads (${stats.test_leads})`}</button>
          <button onClick={reseedDevelopers} disabled={reseeding}>{reseeding ? 'Seeding…' : 'Re-seed developer directory'}</button>
        </div>
      </div>

      <h2>Access</h2>
      <div className="card" style={{ marginBottom: 24 }}>
        <p style={{ margin: '0 0 10px' }}>
          Phase 1 uses a single shared admin token for everyone with access to this CRM — there
          are no individual logins yet, so the lifecycle audit trail can't tell apart two different
          people using the same token.
        </p>
        <button onClick={changeToken}>Re-enter admin token</button>
      </div>

      <h2>Roadmap (Phase 2)</h2>
      <div className="card">
        <p className="muted" style={{ margin: '0 0 10px' }}>Planned, in priority order — not yet built:</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          <li>Individual user accounts, replacing the shared admin token</li>
          <li>Lead assignment (round-robin or by project)</li>
          <li>WhatsApp Business API integration</li>
          <li>Call tracking numbers per campaign</li>
          <li>Offline conversion upload back to Meta/Google</li>
        </ul>
      </div>
    </>
  );
}
