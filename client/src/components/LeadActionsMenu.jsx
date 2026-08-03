import { useState, useEffect, useRef } from 'react';
import Icon from './Icon.jsx';

/**
 * The "⋮" menu at the end of a lead — Edit / Delete, the two actions every
 * row-based tool has. Closes on an outside click or Escape, same as any
 * normal dropdown.
 */
export default function LeadActionsMenu({ onEdit, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="kebab-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="kebab-btn" onClick={() => setOpen((v) => !v)} aria-label="Lead actions">
        <Icon name="more-vertical" size={16} />
      </button>
      {open && (
        <div className="dropdown-menu">
          <button onClick={() => { setOpen(false); onEdit(); }}>
            <Icon name="edit-2" size={14} /> Edit lead
          </button>
          <button className="danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Icon name="trash-2" size={14} /> Delete lead
          </button>
        </div>
      )}
    </div>
  );
}
