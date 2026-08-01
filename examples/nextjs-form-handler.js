/**
 * DROP THIS INTO CORE REALTY'S NEXT.JS SITE.
 * Path: app/api/lead/route.js  (App Router)  — or pages/api/lead.js for Pages Router.
 *
 * The browser posts here. THIS server-side route signs the payload and forwards
 * it to the CRM. The signing secret never reaches the browser.
 *
 * If you skip this and let the browser call the CRM directly, the secret is in
 * your JS bundle, which means it isn't a secret, which means the endpoint is
 * open, which means bots fill your client's CRM. Don't skip this.
 */
import crypto from 'node:crypto';

const CRM_URL = process.env.CRM_URL;                       // https://crm.corerealty.example
const CRM_SECRET = process.env.WEBSITE_INGEST_SECRET;      // same value as the CRM's .env

export async function POST(request) {
  const form = await request.json();

  const payload = {
    full_name: form.full_name,
    phone: form.phone,
    email: form.email,
    budget_range: form.budget_range,
    timeline: form.timeline,
    project_id: form.project_id || null,
    attribution: form.attribution,          // from window.CoreRealtyAttribution.raw()
    company_website: form.company_website,  // honeypot, pass through untouched
  };

  const body = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', CRM_SECRET).update(body).digest('hex');

  const res = await fetch(`${CRM_URL}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': signature },
    body,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    return Response.json(
      { ok: false, error: data.error || 'Could not submit. Please call us.' },
      { status: res.status },
    );
  }
  return Response.json({ ok: true });
}

/* ---------------------------------------------------------------------------
 * Matching client component:
 *
 * 'use client';
 * import { useState } from 'react';
 *
 * export default function LeadForm() {
 *   const [sending, setSending] = useState(false);
 *
 *   async function onSubmit(e) {
 *     e.preventDefault();
 *     setSending(true);
 *     const fd = Object.fromEntries(new FormData(e.target));
 *     fd.attribution = window.CoreRealtyAttribution?.raw() ?? '{}';
 *     const r = await fetch('/api/lead', {
 *       method: 'POST',
 *       headers: { 'Content-Type': 'application/json' },
 *       body: JSON.stringify(fd),
 *     });
 *     setSending(false);
 *     if (r.ok) window.location.href = '/thank-you';   // <- fire your conversion tag here
 *   }
 *
 *   return (
 *     <form onSubmit={onSubmit}>
 *       <input name="full_name" required />
 *       <input name="phone" type="tel" required />
 *       <input name="email" type="email" />
 *       <input name="company_website" tabIndex={-1} autoComplete="off"
 *              style={{ position:'absolute', left:'-9999px' }} aria-hidden="true" />
 *       <button disabled={sending}>{sending ? 'Sending…' : 'Request a callback'}</button>
 *     </form>
 *   );
 * }
 *
 * And in app/layout.js:
 *   <Script src="https://crm.corerealty.example/tracker.js" strategy="afterInteractive" />
 * ------------------------------------------------------------------------- */
