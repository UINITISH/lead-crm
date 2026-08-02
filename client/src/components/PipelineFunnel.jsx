import { fmtINR } from '../lib/format.js';

const LABELS = { new: 'New lead', contacted: 'Contacted', site_visit: 'Site visit', negotiation: 'Negotiation', closed: 'Closed won' };
const COLORS = ['#2f6fed', '#3b82c4', '#6b3fa0', '#b45309', '#1a9d6c'];

export default function PipelineFunnel({ stages }) {
  const visible = stages.filter(s => s.status !== 'dropped');
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {visible.map((s, i) => (
          <div key={s.status} style={{ height: 8, flex: 1, background: COLORS[i],
                                        borderRadius: i === 0 ? '6px 0 0 6px' : i === visible.length - 1 ? '0 6px 6px 0' : 0 }} />
        ))}
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {visible.map((s) => (
          <div key={s.status} style={{ flex: 1 }}>
            <div className="muted" style={{ fontSize: 12 }}>{LABELS[s.status]}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{s.n}</div>
            <div className="muted" style={{ fontSize: 12 }}>{fmtINR(s.value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
