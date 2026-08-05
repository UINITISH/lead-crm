/**
 * Admin API client: session-token storage, login/logout, and the shared
 * fetch wrapper. Everything under /api/admin (other than the login route
 * itself) requires this bearer token — one login per client business.
 *
 * Stored in localStorage (not sessionStorage) so it's remembered permanently
 * on this browser/computer, not just for one tab session. It's still a real
 * bearer token: someone opening the app from a different browser or computer
 * still needs to log in again.
 */
let TOKEN = localStorage.getItem('crm_session') || '';
let BUSINESS = null;
try { BUSINESS = JSON.parse(localStorage.getItem('crm_business') || 'null'); } catch { BUSINESS = null; }

export function token() { return TOKEN; }
export function business() { return BUSINESS; }
export function isLoggedIn() { return Boolean(TOKEN); }

export async function login(email, password) {
  const r = await fetch('/api/admin/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!r.ok || !j.ok) throw new Error(j.error || 'Login failed');
  TOKEN = j.token;
  BUSINESS = j.business;
  localStorage.setItem('crm_session', TOKEN);
  localStorage.setItem('crm_business', JSON.stringify(BUSINESS));
  return BUSINESS;
}

export function logout() {
  TOKEN = '';
  BUSINESS = null;
  localStorage.removeItem('crm_session');
  localStorage.removeItem('crm_business');
}

export async function api(path, opts = {}) {
  const r = await fetch('/api/admin' + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token(), ...(opts.headers || {}) },
  });
  if (r.status === 401) {
    logout();
    throw new Error('Session expired — please log in again');
  }
  return r.json();
}
