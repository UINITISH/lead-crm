export function fmt(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** Budget fields are stored in ₹ lakhs; render the way the team actually talks. */
export function fmtINR(lakhs) {
  if (lakhs == null || lakhs === '') return '—';
  const n = Number(lakhs);
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 100) return '₹' + (n / 100).toFixed(2).replace(/\.00$/, '') + ' Cr';
  return '₹' + Math.round(n) + ' L';
}

export function timeAgo(ts) {
  if (!ts) return '—';
  const diffMs = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diffMs / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  if (d < 30) return d + 'd ago';
  return fmt(ts);
}

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

/**
 * A lead's `tag` is a plain-text snapshot (see db/schema.sql lead_tags
 * comment) — it doesn't carry its own color, so pill rendering looks it up
 * by name against the current managed tag list. If the tag was since
 * renamed or removed in Settings, this just falls back to a neutral gray
 * pill rather than losing the label entirely.
 */
export function tagColorClass(tags, name) {
  if (!name) return 'tag-gray';
  const hit = tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
  return 'tag-' + (hit?.color || 'gray');
}
