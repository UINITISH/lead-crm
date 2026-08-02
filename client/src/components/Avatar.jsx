import { initials } from '../lib/format.js';

const AVATAR_COLORS = [
  { bg: '#e8f0fe', fg: '#1a56db' }, { bg: '#e7f7ef', fg: '#1a9d6c' }, { bg: '#fdf1de', fg: '#b45309' },
  { bg: '#f3ecfd', fg: '#6b3fa0' }, { bg: '#fbe9e8', fg: '#d92d20' }, { bg: '#e6f7f7', fg: '#0f7a7a' },
];

export function avatarColor(name) {
  let sum = 0;
  for (const c of String(name || '?')) sum += c.charCodeAt(0);
  return AVATAR_COLORS[sum % AVATAR_COLORS.length];
}

export default function Avatar({ name, size = 32 }) {
  const c = avatarColor(name);
  return (
    <div className="avatar" style={{ width: size, height: size, background: c.bg, color: c.fg, fontSize: Math.round(size * 0.38) }}>
      {initials(name)}
    </div>
  );
}
