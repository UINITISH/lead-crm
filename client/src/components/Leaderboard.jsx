import Avatar from './Avatar.jsx';

export default function Leaderboard({ rows }) {
  const max = Math.max(1, ...rows.map(r => Number(r.leads_worked)));
  return (
    <div className="card">
      {rows.map(r => (
        <div className="list-row" key={r.actor}>
          <Avatar name={r.actor} size={30} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{r.actor}</div>
            <div style={{ height: 6, background: 'var(--line)', borderRadius: 99, marginTop: 5 }}>
              <div style={{ height: 6, width: (r.leads_worked / max * 100) + '%', background: 'var(--accent)', borderRadius: 99 }} />
            </div>
          </div>
          <div style={{ fontSize: 12, textAlign: 'right', flexShrink: 0 }}>
            <div>{r.leads_closed} closed</div>
            <div className="muted">{r.leads_worked} worked</div>
          </div>
        </div>
      ))}
      {!rows.length && <div className="empty">No activity yet — set "Acting as" in the sidebar to start tracking.</div>}
    </div>
  );
}
