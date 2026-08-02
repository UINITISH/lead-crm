/**
 * Admin API client: token resolution/storage and the shared fetch wrapper.
 * Everything under /api/admin requires this bearer token.
 *
 * Stored in localStorage (not sessionStorage) so it's remembered permanently
 * on this browser/computer — the prompt should only ever appear once per
 * machine, not once per tab session. It's still a real bearer token: someone
 * opening the app from a different browser or computer still needs it.
 */
let TOKEN = '';

export async function resolveToken() {
  const saved = localStorage.getItem('crm_token');
  if (saved) { TOKEN = saved; return; }
  try {
    const r = await fetch('/api/admin/dev-token');
    if (r.ok) {
      const j = await r.json();
      if (j.token) { TOKEN = j.token; localStorage.setItem('crm_token', TOKEN); return; }
    }
  } catch { /* fall through to the prompt */ }
  TOKEN = window.prompt('Admin token') || '';
  if (TOKEN) localStorage.setItem('crm_token', TOKEN);
}

export function token() { return TOKEN; }

export async function api(path, opts = {}) {
  const r = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  });
  if (r.status === 401) { localStorage.removeItem('crm_token'); throw new Error('Unauthorized — reload and re-enter the token'); }
  return r.json();
}
