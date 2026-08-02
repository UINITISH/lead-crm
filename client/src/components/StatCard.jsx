import Icon from './Icon.jsx';

export default function StatCard({ icon, iconBg, iconFg, label, value, trend }) {
  const up = trend >= 0;
  return (
    <div className="card">
      <div className="stat-icon" style={{ background: iconBg, color: iconFg }}>
        {icon === 'rupee' ? <span style={{ fontSize: 17, fontWeight: 700 }}>₹</span> : <Icon name={icon} size={18} />}
      </div>
      <div className="l">{label}</div>
      <div className="n">{value}</div>
      {trend !== undefined && (
        <div style={{ fontSize: 12, marginTop: 6, display: 'flex', alignItems: 'center', gap: 4,
                      color: up ? 'var(--good)' : 'var(--bad)' }}>
          <Icon name={up ? 'trending-up' : 'trending-down'} size={13} />
          {Math.abs(trend)}% vs last month
        </div>
      )}
    </div>
  );
}
