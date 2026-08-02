import { useState, useEffect, useCallback } from 'react';
import Icon from '../components/Icon.jsx';
import { api } from '../lib/api.js';

/** A single project row: name/location, possession date, and its unit-type breakdown, if any. */
function ProjectRow({ p }) {
  return (
    <div className="proj-row" style={{ display: 'block' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
        <span className="muted" style={{ fontSize: 12 }}>{p.location || ''}</span>
      </div>
      {p.possession && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>Possession: {p.possession}</div>
      )}
      {p.inventory_notes && (
        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{p.inventory_notes}</div>
      )}
      {p.unit_types?.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {p.unit_types.map(u => (
            <span key={u.id} className="pill" style={{ background: '#f0f2f5', color: 'var(--text)' }}>
              {[u.configuration, u.dimension, u.price_range].filter(Boolean).join(' · ') || '—'}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Projects with no confidently-matched developer, grouped by area (broad locality). */
function IndependentProjects({ projects }) {
  if (!projects.length) return null;
  const byArea = {};
  projects.forEach(p => {
    const k = p.area || 'Other';
    (byArea[k] = byArea[k] || []).push(p);
  });

  return (
    <>
      <h2>Independent / other listed projects</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 12, fontSize: 12 }}>
        No developer confidently matched for these yet — grouped by area instead.
      </p>
      {Object.entries(byArea).map(([area, list]) => (
        <div className="dev-card" key={area}>
          <div className="dev-card-head" style={{ cursor: 'default' }}>
            <span className="name">{area}</span>
            <span className="muted" style={{ fontSize: 12 }}>{list.length} project{list.length === 1 ? '' : 's'}</span>
          </div>
          <div>
            {list.map(p => <ProjectRow p={p} key={p.id} />)}
          </div>
        </div>
      ))}
    </>
  );
}

export default function DevelopersPage() {
  const [devs, setDevs] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [projectsById, setProjectsById] = useState({});
  const [independentProjects, setIndependentProjects] = useState([]);
  const [showNewDev, setShowNewDev] = useState(false);
  const [newDev, setNewDev] = useState({ name: '', grade: '' });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, p] = await Promise.all([api('/developers'), api('/projects')]);
      setDevs(d.developers || []);
      setIndependentProjects((p.projects || []).filter(pr => !pr.developer_id));
      setLoadError(null);
    } catch (e) { setLoadError(e.message); }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function toggle(dev) {
    if (openId === dev.id) { setOpenId(null); return; }
    setOpenId(dev.id);
    if (!projectsById[dev.id]) {
      const r = await api('/projects?developer_id=' + dev.id);
      setProjectsById(p => ({ ...p, [dev.id]: r.projects || [] }));
    }
  }

  async function addDeveloper(e) {
    e.preventDefault();
    if (!newDev.name.trim()) return;
    await api('/developers', { method: 'POST', body: JSON.stringify(newDev) });
    setNewDev({ name: '', grade: '' });
    setShowNewDev(false);
    load();
  }

  const gradeA = devs.filter(d => d.grade === 'A');
  const gradeB = devs.filter(d => d.grade === 'B');
  const gradeOther = devs.filter(d => !d.grade);

  const Group = ({ title, list }) => list.length > 0 && (
    <>
      <h2>{title}</h2>
      {list.map(dev => (
        <div className="dev-card" key={dev.id}>
          <div className="dev-card-head" onClick={() => toggle(dev)}>
            <span className="name">{dev.name}</span>
            {dev.grade && <span className={'pill grade-' + dev.grade}>Grade {dev.grade}</span>}
            <span className="muted" style={{ fontSize: 12 }}>{dev.project_count} project{dev.project_count === 1 ? '' : 's'}</span>
            <Icon name="chevron" size={16} />
          </div>
          {openId === dev.id && (
            <div>
              {(projectsById[dev.id] || []).map(p => <ProjectRow p={p} key={p.id} />)}
              {(projectsById[dev.id] || []).length === 0 && (
                <div className="proj-row muted">No projects listed yet.</div>
              )}
            </div>
          )}
        </div>
      ))}
    </>
  );

  return (
    <>
      <div className="topbar">
        <h1>Developers & projects</h1>
        <div className="grow" />
        <button onClick={load}><Icon name="refresh" size={14} /> Refresh</button>
        <button className="primary" onClick={() => setShowNewDev(true)}><Icon name="plus" size={14} /> Add developer</button>
      </div>

      {loadError && <div className="card" style={{ borderColor: 'var(--bad)', color: 'var(--bad)', marginBottom: 16 }}>{loadError}</div>}

      {showNewDev && (
        <div className="modal-backdrop" onClick={() => setShowNewDev(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h1>Add developer</h1>
            <form onSubmit={addDeveloper}>
              <div className="field">
                <label>Name *</label>
                <input value={newDev.name} onChange={e => setNewDev(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Casagrand" required />
              </div>
              <div className="field">
                <label>Grade</label>
                <select value={newDev.grade} onChange={e => setNewDev(d => ({ ...d, grade: e.target.value }))}>
                  <option value="">Unknown</option>
                  <option value="A">A-Grade</option>
                  <option value="B">B-Grade</option>
                </select>
              </div>
              <div className="modal-actions">
                <button type="button" onClick={() => setShowNewDev(false)}>Cancel</button>
                <button type="submit" className="primary">Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {loading && <div className="empty">Loading…</div>}
      {!loading && (
        <>
          <Group title="A-Grade builders" list={gradeA} />
          <Group title="B-Grade builders" list={gradeB} />
          <Group title="Other" list={gradeOther} />
          <IndependentProjects projects={independentProjects} />
        </>
      )}
    </>
  );
}
