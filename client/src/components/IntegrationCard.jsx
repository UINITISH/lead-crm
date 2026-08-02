import CopyField from './CopyField.jsx';

export default function IntegrationCard({ title, configured, webhookUrl, children }) {
  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 14, flex: 1 }}>{title}</p>
        <span className={'pill ' + (configured ? 'st-closed' : 'st-dropped')}>
          {configured ? 'Connected' : 'Not configured'}
        </span>
      </div>
      {webhookUrl && (
        <div style={{ marginBottom: children ? 10 : 0 }}>
          <label style={{ display: 'block', fontSize: 11, color: 'var(--muted)', marginBottom: 4,
                          textTransform: 'uppercase', letterSpacing: .4 }}>Webhook URL</label>
          <CopyField value={webhookUrl} />
        </div>
      )}
      {children}
    </div>
  );
}
