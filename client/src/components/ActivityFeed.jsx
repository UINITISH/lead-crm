import Icon from './Icon.jsx';
import { timeAgo } from '../lib/format.js';

export default function ActivityFeed({ items }) {
  const iconFor = (t) => t === 'created' ? 'plus' : t === 'status_change' ? 'trending-up' : 'activity';
  const textFor = (a) => {
    if (a.event_type === 'created') return (a.full_name || 'A lead') + ' was added';
    if (a.event_type === 'status_change') return (a.full_name || 'A lead') + ' moved to ' + a.to_status.replace('_', ' ');
    return (a.full_name || 'A lead') + (a.note ? ': ' + a.note : ' was updated');
  };
  return (
    <div className="card">
      {items.map(a => (
        <div className="list-row" key={a.id}>
          <div className="stat-icon" style={{ width: 28, height: 28, margin: 0, background: 'var(--accent-bg)', color: 'var(--accent)' }}>
            <Icon name={iconFor(a.event_type)} size={14} />
          </div>
          <div style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
            {textFor(a)}{a.actor ? <span className="muted"> · by {a.actor}</span> : null}
          </div>
          <div className="muted" style={{ fontSize: 12, flexShrink: 0 }}>{timeAgo(a.created_at)}</div>
        </div>
      ))}
      {!items.length && <div className="empty">No activity yet.</div>}
    </div>
  );
}
