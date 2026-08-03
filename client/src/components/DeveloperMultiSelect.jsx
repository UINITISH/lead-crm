import { useState, useEffect } from 'react';
import { api } from '../lib/api.js';

/**
 * Hoisted to module scope on purpose — a component defined inline inside
 * another component's render body gets a brand-new identity every render,
 * which makes React unmount and remount the whole checkbox list on every
 * single toggle (loses scroll position, breaks any queued interaction).
 * Keeping it stable here means a toggle only patches the one checkbox that
 * changed.
 */
function DevGroup({ title, list, checkedIds, onToggle }) {
  if (!list.length) return null;
  return (
    <div style={{ marginBottom: 6 }}>
      <div className="muted" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.4px', margin: '4px 0' }}>{title}</div>
      {list.map((d) => (
        <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={checkedIds.has(d.id)} onChange={() => onToggle(d.id)} style={{ width: 'auto', padding: 0 }} />
          {d.name}
        </label>
      ))}
    </div>
  );
}

/**
 * Multi-select for one or more developers on a lead, backed by the curated
 * developer directory (checkboxes, grouped by grade) plus a free-text "add
 * another" for a builder that isn't in the directory yet — same
 * comma-separated free-text convention already used everywhere developer
 * names show up on a lead, just with a proper picker instead of typing a
 * list by hand.
 *
 * Reports back both the full display list (`names`) and which entries are
 * known directory developers with a real id (`ids`) — callers use `ids` to
 * decide whether a single, unambiguous developer_id link is possible (e.g.
 * for filtering the project dropdown), or whether this is a multi-developer
 * / freeform case that should just be stored as text.
 */
export default function DeveloperMultiSelect({ initialNames = [], onChange }) {
  const [devs, setDevs] = useState([]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [extra, setExtra] = useState([]);
  const [newName, setNewName] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api('/developers').then((r) => {
      const list = r.developers || [];
      setDevs(list);
      const byLowerName = new Map(list.map((d) => [d.name.toLowerCase(), d]));
      const ids = new Set();
      const leftover = [];
      for (const n of initialNames) {
        const hit = byLowerName.get(n.trim().toLowerCase());
        if (hit) ids.add(hit.id);
        else if (n.trim()) leftover.push(n.trim());
      }
      setCheckedIds(ids);
      setExtra(leftover);
      setLoaded(true);
    }).catch(() => setLoaded(true));
    // Only ever run once on mount — initialNames is a starting point, not a live prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const knownNames = devs.filter((d) => checkedIds.has(d.id)).map((d) => d.name);
    onChange({ names: [...knownNames, ...extra], ids: Array.from(checkedIds) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedIds, extra, loaded]);

  function toggle(id) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function addExtra() {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setExtra((prev) => [...prev, trimmed]);
    setNewName('');
  }

  const gradeA = devs.filter((d) => d.grade === 'A');
  const gradeB = devs.filter((d) => d.grade === 'B');
  const gradeOther = devs.filter((d) => !d.grade);

  const selected = [
    ...devs.filter((d) => checkedIds.has(d.id)).map((d) => ({ label: d.name, onRemove: () => toggle(d.id) })),
    ...extra.map((n, i) => ({ label: n, onRemove: () => setExtra((prev) => prev.filter((_, idx) => idx !== i)) })),
  ];

  return (
    <div>
      {selected.length > 0 && (
        <div className="dev-pills" style={{ marginBottom: 8 }}>
          {selected.map((s, i) => (
            <span className="dev-pill" key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {s.label}
              <button type="button" onClick={s.onRemove}
                      style={{ padding: 0, border: 'none', background: 'none', lineHeight: 1, fontSize: 13, cursor: 'pointer', color: 'inherit' }}>
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 10px' }}>
        <DevGroup title="A-Grade" list={gradeA} checkedIds={checkedIds} onToggle={toggle} />
        <DevGroup title="B-Grade" list={gradeB} checkedIds={checkedIds} onToggle={toggle} />
        <DevGroup title="Other" list={gradeOther} checkedIds={checkedIds} onToggle={toggle} />
        {loaded && !devs.length && <div className="muted" style={{ fontSize: 12 }}>No developers in the directory yet.</div>}
        {!loaded && <div className="muted" style={{ fontSize: 12 }}>Loading…</div>}
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Add a developer not listed above"
               onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addExtra(); } }} style={{ flex: 1 }} />
        <button type="button" onClick={addExtra}>Add</button>
      </div>
    </div>
  );
}
