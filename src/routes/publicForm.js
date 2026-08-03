/**
 * Public, unauthenticated lead-capture form pages — the "Contact Form 7"
 * equivalent. GET /f/:public_id renders a small self-contained HTML page
 * meant to be embedded via <iframe> on a WordPress site (or any site).
 * POST /f/:public_id/submit handles the browser's normal form POST and
 * inserts a lead.
 *
 * No shared secret here, unlike /api/leads/website — this page is served BY
 * this app, so the browser's POST is same-origin from the iframe's point of
 * view. Protection is a honeypot field + a per-IP rate limit, same posture
 * as any public "contact us" form.
 */
import express from 'express';
import { insertLead, logIngest } from '../leads.js';
import { normalizePhone, normalizeEmail, cleanText, extractAttribution } from '../normalize.js';
import { getFormByPublicId } from '../forms.js';
import { listDevelopers, listProjects } from '../developers.js';

export const publicFormRouter = express.Router();

// Real <form> POSTs arrive as x-www-form-urlencoded, not JSON — the app-wide
// express.json() in server.js won't touch this content-type, so this router
// needs its own parser.
publicFormRouter.use(express.urlencoded({ extended: true }));

const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > MAX_PER_WINDOW;
}

const BUDGET_BANDS = ['Under 50L', '50L - 75L', '75L - 1Cr', '1Cr - 1.5Cr', '1.5Cr - 2Cr', '2Cr+'];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

async function projectOptions(form, selectedValue) {
  let devs = await listDevelopers();
  if (form.developer_name) {
    devs = devs.filter((d) => d.name.toLowerCase() === form.developer_name.toLowerCase());
  }
  let html = '';
  for (const dev of devs) {
    const projects = await listProjects({ developer_id: dev.id });
    if (!projects.length) continue;
    html += `<optgroup label="${esc(dev.name)}">`;
    for (const p of projects) {
      const value = `${dev.name}|||${p.name}`;
      const sel = value === selectedValue ? ' selected' : '';
      html += `<option value="${esc(value)}"${sel}>${esc(p.name)}</option>`;
    }
    html += `</optgroup>`;
  }
  return html;
}

function page({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         color:#1f2430; background:#fff; }
  h1 { font-size:17px; margin:0 0 14px; }
  label { display:block; font-size:12.5px; font-weight:600; margin:12px 0 4px; }
  input, select, textarea {
    width:100%; padding:9px 10px; border:1px solid #dfe2e7; border-radius:8px;
    font-size:14px; font-family:inherit; color:#1f2430; background:#fff;
  }
  textarea { resize:vertical; min-height:70px; }
  input:focus, select:focus, textarea:focus { outline:2px solid #2f6fed; outline-offset:1px; }
  button { margin-top:16px; width:100%; padding:11px; border:none; border-radius:8px;
           background:#2f6fed; color:#fff; font-size:14.5px; font-weight:600; cursor:pointer; }
  button:hover { background:#255fd6; }
  .hp { position:absolute; left:-9999px; opacity:0; height:0; }
  .err { background:#fbe9e8; color:#d92d20; padding:9px 12px; border-radius:8px; font-size:13px; margin-bottom:12px; }
  .thanks { text-align:center; padding:36px 12px; }
  .thanks h1 { font-size:19px; }
  .thanks p { color:#6b7280; font-size:14px; }
  .req { color:#d92d20; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

async function formBody(form, { error = null, values = {} } = {}) {
  return `
${error ? `<div class="err">${esc(error)}</div>` : ''}
<h1>${esc(form.name)}</h1>
<form method="POST" action="/f/${esc(form.public_id)}/submit">
  <input class="hp" type="text" name="company_website" tabindex="-1" autocomplete="off" />

  <label>Full name <span class="req">*</span></label>
  <input type="text" name="full_name" required value="${esc(values.full_name)}" />

  <label>Phone <span class="req">*</span></label>
  <input type="tel" name="phone" required value="${esc(values.phone)}" />

  ${form.show_email ? `
  <label>Email</label>
  <input type="email" name="email" value="${esc(values.email)}" />` : ''}

  ${form.show_budget ? `
  <label>Budget</label>
  <select name="budget_range">
    <option value="">Select…</option>
    ${BUDGET_BANDS.map((b) => `<option value="${esc(b)}"${values.budget_range === b ? ' selected' : ''}>${esc(b)}</option>`).join('')}
  </select>` : ''}

  ${form.show_project ? `
  <label>Interested in</label>
  <select name="project_choice">
    <option value="">Select a project (optional)…</option>
    ${await projectOptions(form, values.project_choice)}
  </select>` : ''}

  ${form.show_message ? `
  <label>Message</label>
  <textarea name="message">${esc(values.message)}</textarea>` : ''}

  <button type="submit">Submit</button>
</form>`;
}

publicFormRouter.get('/:public_id', async (req, res) => {
  const form = await getFormByPublicId(req.params.public_id);
  if (!form || !form.is_active) {
    return res.status(404).send(page({
      title: 'Form not found',
      body: `<div class="thanks"><h1>This form isn't available.</h1><p>It may have been removed or turned off.</p></div>`,
    }));
  }
  const body = await formBody(form, {});
  res.send(page({ title: form.name, body }));
});

publicFormRouter.post('/:public_id/submit', async (req, res) => {
  const ip = req.ip;
  const body = req.body || {};
  const form = await getFormByPublicId(req.params.public_id);

  if (!form || !form.is_active) {
    return res.status(404).send(page({
      title: 'Form not found',
      body: `<div class="thanks"><h1>This form isn't available.</h1></div>`,
    }));
  }

  const reRender = async (error) => {
    const body_ = await formBody(form, { error, values: body });
    return res.status(400).send(page({ title: form.name, body: body_ }));
  };

  if (rateLimited(ip)) {
    await logIngest({ source: 'website', outcome: 'rejected', reason: 'rate limited', http_status: 429, payload: body });
    return reRender('Too many submissions — please wait a minute and try again.');
  }

  // Honeypot: hidden field real visitors never fill in.
  if (cleanText(body.company_website)) {
    await logIngest({ source: 'website', outcome: 'rejected', reason: 'honeypot', http_status: 200, payload: body });
    return res.send(page({
      title: form.name,
      body: `<div class="thanks"><h1>Thanks!</h1><p>We'll be in touch shortly.</p></div>`,
    })); // lie to the bot, same as the website webhook does
  }

  const full_name = cleanText(body.full_name, 200);
  if (!full_name) return reRender('Please enter your name.');

  const phone_e164 = normalizePhone(body.phone);
  if (!phone_e164) return reRender('Please enter a valid phone number.');

  let developer_name = form.developer_name || null;
  let project_name = null;
  if (body.project_choice) {
    const [devPart, projPart] = String(body.project_choice).split('|||');
    developer_name = cleanText(devPart) || developer_name;
    project_name = cleanText(projPart);
  }

  const attr = extractAttribution(req.query || {});

  try {
    const { lead, outcome } = await insertLead({
      full_name,
      phone_raw: cleanText(body.phone, 50),
      phone_e164,
      email: normalizeEmail(body.email),
      budget_range: cleanText(body.budget_range, 100),
      developer_name,
      project_name,
      source: 'website',
      form_id: form.public_id,
      form_name: form.name,
      ...attr,
      landing_page: cleanText(req.get('Referer'), 1000),
      raw_payload: { ...body, message: cleanText(body.message, 2000) },
      submitted_at: new Date().toISOString(),
    });

    await logIngest({ source: 'website', outcome, lead_id: lead.id, http_status: 201, payload: body });

    return res.send(page({
      title: form.name,
      body: `<div class="thanks"><h1>Thanks, ${esc(full_name.split(' ')[0])}!</h1><p>We've received your details and will be in touch shortly.</p></div>`,
    }));
  } catch (err) {
    console.error('[public-form] insert failed:', err);
    await logIngest({ source: 'website', outcome: 'error', reason: err.message, http_status: 500, payload: body });
    return reRender('Something went wrong on our end — please try again in a moment.');
  }
});
