import { useState, useMemo } from 'react';
import Icon from '../components/Icon.jsx';
import { HELP_TOPICS } from '../lib/helpTopics.jsx';

export default function HelpPage() {
  const [q, setQ] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());

  const query = q.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!query) return HELP_TOPICS;
    return HELP_TOPICS.filter((t) =>
      t.title.toLowerCase().includes(query) || t.keywords.toLowerCase().includes(query));
  }, [query]);

  function toggle(id) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function expandAll() {
    setOpenIds(new Set(visible.map((t) => t.id)));
  }
  function collapseAll() {
    setOpenIds(new Set());
  }

  // While searching, show every match open regardless of manual state — no
  // point making someone click into a result they just searched for.
  const isOpen = (id) => (query ? true : openIds.has(id));

  return (
    <>
      <div className="topbar">
        <h1>Help Center</h1>
        <div className="grow" />
        <button onClick={expandAll}>Expand all</button>
        <button onClick={collapseAll}>Collapse all</button>
      </div>

      <p className="muted" style={{ marginTop: -4, marginBottom: 16, fontSize: 13 }}>
        A plain-language reference for every feature in this CRM — what each part does, how to use it, and what to
        check first if something's not behaving the way you expect.
      </p>

      <div className="card" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search — e.g. 'tag', 'Meta', 'embed'…"
               style={{ border: 'none', flex: 1, fontSize: 14, padding: '4px 0' }} />
        {q && <button onClick={() => setQ('')} style={{ padding: '4px 8px' }}><Icon name="x" size={12} /></button>}
      </div>

      {!visible.length && (
        <div className="card">No topics match "{q}" — try a different word, or ask directly and I'll walk you through it.</div>
      )}

      {visible.map((t) => (
        <div className="card help-card" key={t.id} style={{ marginBottom: 10 }} onClick={() => toggle(t.id)}>
          <div className="help-card-head">
            <span className="name">{t.title}</span>
            <span style={{ display: 'inline-flex', transform: isOpen(t.id) ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform .15s' }}>
              <Icon name="chevron" size={15} />
            </span>
          </div>
          {isOpen(t.id) && (
            <div className="help-topic" style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}>
              {t.body}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
