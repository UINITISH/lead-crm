import { useState, useEffect, useRef, useCallback } from 'react';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';

const POLL_MS = 20_000;
const SINCE_KEY = 'crm_leads_seen_since';
const MAX_ITEMS = 30;

/**
 * Alerts whoever's watching the CRM the moment a new lead lands — from the
 * website form, Meta, Google, or a manual entry — without them having to sit
 * on the Leads tab refreshing it. Three layers, cheapest first:
 *
 *   1. A bell in the sidebar with an unread badge + a dropdown of recent
 *      arrivals — always there, no permission needed.
 *   2. A toast in the corner of the screen for a few seconds when it happens,
 *      so it's noticed even while working on something else in the app.
 *   3. A real desktop/OS notification via the browser's Notification API, if
 *      the person has granted permission — this is the one that still shows
 *      up if the CRM tab is in the background or minimised.
 *
 * There's no WebSocket/push server behind this — Vercel's serverless
 * functions don't hold a persistent connection open — so it's a lightweight
 * poll instead: every 20s, ask for leads created after the last lead we
 * already saw (GET /leads?from=…, which the API already supports). That
 * "since" pointer is saved in localStorage, not memory, specifically so
 * leaving the tab closed for an hour and coming back still surfaces
 * everything that arrived while it was closed — it does NOT replay the
 * entire lead history on first use, since it's seeded to "now" the very
 * first time this ever runs on a given browser.
 */
export default function LeadNotifications({ onOpenLead }) {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const sinceRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!sinceRef.current) {
      sinceRef.current = localStorage.getItem(SINCE_KEY) || new Date().toISOString();
      localStorage.setItem(SINCE_KEY, sinceRef.current);
    }
  }, []);

  const poll = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ from: sinceRef.current, limit: '50' }).toString();
      const r = await api('/leads?' + qs);
      const fresh = (r.leads || [])
        .filter((l) => new Date(l.created_at) > new Date(sinceRef.current))
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      if (!fresh.length) return;

      sinceRef.current = fresh[fresh.length - 1].created_at;
      localStorage.setItem(SINCE_KEY, sinceRef.current);

      setItems((prev) => [...fresh].reverse().concat(prev).slice(0, MAX_ITEMS));
      setUnread((n) => n + fresh.length);

      for (const lead of fresh) pushToast(lead);

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const n = fresh.length === 1
          ? new Notification('New lead', { body: describeLead(fresh[0]), tag: fresh[0].id })
          : new Notification(`${fresh.length} new leads`, { body: fresh.map(describeLead).join(', ') });
        n.onclick = () => { window.focus(); if (fresh.length === 1) onOpenLead?.(fresh[0]); };
      }
    } catch {
      // A failed poll just tries again in 20s — no need to surface a background sync hiccup as an error.
    }
  }, [onOpenLead]);

  const [toasts, setToasts] = useState([]);
  function pushToast(lead) {
    const id = lead.id + '-' + Date.now();
    setToasts((t) => [...t, { id, lead }].slice(-4));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 7000);
  }

  useEffect(() => {
    // First check shortly after mount (not instantly — let the initial page
    // load settle first), then every POLL_MS after that.
    const first = setTimeout(poll, 3000);
    const t = setInterval(poll, POLL_MS);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [poll]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  function toggleOpen() {
    setOpen((v) => !v);
    if (!open) setUnread(0);
  }

  async function enableDesktopAlerts() {
    const res = await Notification.requestPermission();
    setPermission(res);
  }

  return (
    <>
      <div className="lead-notif-wrap" ref={wrapRef}>
        <button className="lead-notif-bell" onClick={toggleOpen} aria-label="New lead notifications">
          <Icon name="bell" size={17} />
          {unread > 0 && <span className="lead-notif-badge">{unread > 9 ? '9+' : unread}</span>}
        </button>
        {open && (
          <div className="dropdown-menu lead-notif-panel">
            <div className="lead-notif-panel-head">
              <span>New leads</span>
              {permission === 'default' && (
                <button className="lead-notif-enable" onClick={enableDesktopAlerts}>Enable desktop alerts</button>
              )}
            </div>
            {items.length === 0 && (
              <p className="muted" style={{ padding: '10px 12px', fontSize: 12, margin: 0 }}>
                Nothing yet this session — new leads will show up here as they come in.
              </p>
            )}
            {items.map((lead) => (
              <button key={lead.id} className="lead-notif-item"
                      onClick={() => { setOpen(false); onOpenLead?.(lead); }}>
                <span className={'pill src-' + lead.source}>{lead.source}</span>
                <span className="lead-notif-item-name">{lead.full_name || lead.phone_e164}</span>
                <span className="muted lead-notif-item-time">{relTime(lead.created_at)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lead-toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="lead-toast" onClick={() => { onOpenLead?.(t.lead); setToasts((ts) => ts.filter((x) => x.id !== t.id)); }}>
            <Icon name="bell" size={15} />
            <div>
              <div className="lead-toast-title">New lead</div>
              <div className="lead-toast-body">{describeLead(t.lead)}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function describeLead(lead) {
  return `${lead.full_name || lead.phone_e164} · ${lead.source}`;
}

function relTime(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
