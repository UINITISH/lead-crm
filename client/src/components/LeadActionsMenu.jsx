import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon.jsx';

/**
 * The "⋮" menu at the end of a lead — Edit / Delete, the two actions every
 * row-based tool has.
 *
 * Rendered via a portal into document.body, positioned to the button's
 * on-screen coordinates, rather than as a normal absolutely-positioned child.
 * The row this button lives in is inside a <table> that has `overflow:hidden`
 * (so its rounded corners clip correctly) — a menu positioned the normal way
 * gets silently clipped by that ancestor for any row near the table's bottom
 * or right edge, which reads as "I clicked the dots and nothing happened."
 * Escaping to body sidesteps that entirely.
 *
 * Closes on an outside click, Escape, or scroll (rather than trying to track
 * the button's new position while scrolling — simpler and nothing is lost,
 * since the whole point of opening it was to click Edit/Delete right away).
 */
export default function LeadActionsMenu({ onEdit, onDelete, canEdit = true }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnWrapRef = useRef(null);
  const menuRef = useRef(null);

  function toggle() {
    if (!open) {
      const r = btnWrapRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
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
    <div className="kebab-wrap" ref={btnWrapRef} onClick={(e) => e.stopPropagation()}>
      <button className="kebab-btn" onClick={toggle} aria-label="Lead actions">
        <Icon name="more-vertical" size={16} />
      </button>
      {open && pos && createPortal(
        <div
          className="dropdown-menu"
          ref={menuRef}
          style={{ position: 'fixed', top: pos.top, right: pos.right }}
          onClick={(e) => e.stopPropagation()}
        >
          {canEdit && (
            <button onClick={() => { setOpen(false); onEdit(); }}>
              <Icon name="edit-2" size={14} /> Edit lead
            </button>
          )}
          <button className="danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Icon name="trash-2" size={14} /> Delete lead
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}
