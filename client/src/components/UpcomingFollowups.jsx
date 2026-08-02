import Icon from './Icon.jsx';
import { fmt } from '../lib/format.js';

export default function UpcomingFollowups({ items, onDone }) {
  return (
    <div className="card">
      {items.map(f => (
        <div className="list-row" key={f.id}>
          <button onClick={() => onDone(f.id)} title="Mark done"
                  style={{ width: 28, height: 28, padding: 0, borderRadius: '50%', flexShrink: 0 }}>
            <Icon name="check" size={13} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{f.full_name}</div>
            <div className="muted" style={{ fontSize: 12 }}>{f.note || 'Follow up'}</div>
          </div>
          <div className="muted" style={{ fontSize: 12, textAlign: 'right', flexShrink: 0 }}>{fmt(f.due_at)}</div>
        </div>
      ))}
      {!items.length && <div className="empty">No upcoming follow-ups.</div>}
    </div>
  );
}
