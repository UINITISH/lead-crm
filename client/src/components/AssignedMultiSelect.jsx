import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

/**
 * Inline "Assigned" control for a lead — shows who it's currently assigned
 * to as small pills, and clicking opens a checklist of every rep who has an
 * email set (Settings → Team) to toggle. Only reps with an email are
 * assignable, since assignment is stored as an email address, not a rep id
 * (see leads.assigned_emails in db/schema.sql) — a lead can be assigned to
 * zero, one, or several people at once.
 *
 * Same portal + fixed-positioning pattern as LeadActionsMenu: the table this
 * lives in has `overflow:hidden` for its rounded corners, which would
 * otherwise silently clip a normally-positioned dropdown near the table's
 * edges.
 */
export default function AssignedMultiSelect({ assigned = [], reps = [], onToggle, saving = false }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnWrapRef = useRef(null);
  const menuRef = useRef(null);

  const assignable = reps.filter((r) => r.email);
  const assignedSet = new Set(assigned.map((e) => e.toLowerCase()));
  const assignedReps = assignable.filter((r) => assignedSet.has(r.email.toLowerCase()));
  // An assigned email might not (or no longer) match an active rep with that
  // email — show it plainly rather than silently dropping it from view.
  const unmatched = assigned.filter((e) => !assignable.some((r) => r.email.toLowerCase() === e.toLowerCase()));

  function toggle() {
    if (!open) {
      const r = btnWrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (btnWrapRef.current?.contains(e.target)) return;
      if (menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <div ref={btnWrapRef} onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
      <button type="button" onClick={toggle} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', fontSize: 12,
                       background: '#fff', border: '1px solid var(--line)', borderRadius: 6, cursor: 'pointer', maxWidth: 180 }}>
        {assignedReps.length || unmatched.length ? (
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {assignedReps.map((r) => r.name).concat(unmatched).join(', ')}
          </span>
        ) : (
          <span className="muted">Unassigned</span>
        )}
        <Icon name="chevron" size={12} />
      </button>

      {open && pos && createPortal(
        <div
          ref={menuRef}
          className="dropdown-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, right: 'auto', minWidth: 200, maxHeight: 220, overflowY: 'auto', padding: '6px 10px' }}
          onClick={(e) => e.stopPropagation()}
        >
          {assignable.length === 0 && (
            <div className="muted" style={{ fontSize: 12, padding: '4px 0' }}>
              No team member has an email set yet — add one under Settings → Team.
            </div>
          )}
          {assignable.map((r) => (
            <label key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 0', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={assignedSet.has(r.email.toLowerCase())}
                     onChange={() => onToggle(r.email)} style={{ width: 'auto', padding: 0 }} />
              {r.name} <span className="muted" style={{ fontSize: 11 }}>{r.email}</span>
            </label>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}
