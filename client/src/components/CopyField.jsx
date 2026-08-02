import { useState } from 'react';

export default function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { /* clipboard unavailable — the text is still selectable */ }
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      <code style={{ flex: 1, background: '#fafbfc', border: '1px solid var(--line)', borderRadius: 6,
                     padding: '6px 8px', fontSize: 12, overflow: 'auto', whiteSpace: 'nowrap' }}>{value}</code>
      <button onClick={copy} style={{ flexShrink: 0 }}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
