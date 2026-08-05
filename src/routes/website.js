/**
 * POST /api/leads/website
 *
 * The website form's submission endpoint. Built first, as the spec says —
 * it validates the schema before the harder Meta/Google work lands on top.
 *
 * Auth: HMAC-SHA256 over the raw body, sent as X-CRM-Signature.
 * The spec had no auth on this endpoint. An unauthenticated public lead
 * endpoint gets found by bots within days, and then your client's "lead count"
 * is garbage and the whole report loses credibility. Sign it server-side.
 */
import express from 'express';
import crypto from 'node:crypto';
import { insertLead, logIngest } from '../leads.js';
import { getDefaultBusinessId } from '../auth.js';
import {
  normalizePhone, normalizeEmail, cleanText, extractAttribution, inferSource,
} from '../normalize.js';

export const websiteRouter = express.Router();

// --- crude in-memory rate limit. Swap for Redis when you run >1 process. ----
const hits = new Map();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const rec = hits.get(ip) || { count: 0, reset: now + WINDOW_MS };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WINDOW_MS; }
  rec.count += 1;
  hits.set(ip, rec);
  return rec.count > MAX_PER_WINDOW;
}

function verifySignature(req) {
  const secret = process.env.WEBSITE_INGEST_SECRET;
  if (!secret) return { ok: false, reason: 'WEBSITE_INGEST_SECRET not configured' };

  const given = req.get('X-CRM-Signature') || '';
  const expected = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || '')
    .digest('hex');

  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, reason: 'bad signature' };
  }
  return { ok: true };
}

websiteRouter.post('/website', async (req, res) => {
  const ip = req.ip;
  const body = req.body || {};
  const businessId = await getDefaultBusinessId();

  if (rateLimited(ip)) {
    await logIngest(businessId, { source: 'website', outcome: 'rejected', reason: 'rate limited', http_status: 429, payload: body });
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  const sig = verifySignature(req);
  if (!sig.ok) {
    await logIngest(businessId, { source: 'website', outcome: 'rejected', reason: sig.reason, http_status: 401, payload: body });
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  // Honeypot: a hidden field real users never fill. Cheapest bot filter there is.
  if (cleanText(body.company_website)) {
    await logIngest(businessId, { source: 'website', outcome: 'rejected', reason: 'honeypot', http_status: 200, payload: body });
    return res.status(200).json({ ok: true }); // lie to the bot
  }

  const phone_e164 = normalizePhone(body.phone);
  if (!phone_e164) {
    await logIngest(businessId, { source: 'website', outcome: 'rejected', reason: 'invalid phone', http_status: 400, payload: body });
    return res.status(400).json({ ok: false, error: 'A valid phone number is required', field: 'phone' });
  }

  // Attribution can arrive either flattened on the body or inside the blob
  // that tracker.js writes into the hidden `attribution` field.
  let tracker = {};
  if (body.attribution) {
    try {
      tracker = typeof body.attribution === 'string' ? JSON.parse(body.attribution) : body.attribution;
    } catch { tracker = {}; }
  }
  const attr = extractAttribution({ ...(tracker.last_touch || {}), ...body });

  try {
    const { lead, outcome } = await insertLead(businessId, {
      full_name:    cleanText(body.full_name ?? body.name, 200),
      phone_raw:    cleanText(body.phone, 50),
      phone_e164,
      email:        normalizeEmail(body.email),
      budget_range: cleanText(body.budget_range ?? body.budget, 100),
      timeline:     cleanText(body.timeline, 100),
      project_id:   body.project_id || null,

      // Trust an explicit source only if it's one we know; otherwise infer.
      source: ['meta', 'google', 'website'].includes(body.source)
        ? body.source
        : inferSource(attr),

      ...attr,
      campaign_name: attr.utm_campaign,
      first_touch:   tracker.first_touch || null,
      is_test:       Boolean(body.is_test),
      raw_payload:   body,
      submitted_at:  new Date().toISOString(),
    });

    await logIngest(businessId, { source: 'website', outcome, lead_id: lead.id, http_status: 201, payload: body });
    return res.status(201).json({ ok: true, lead_id: lead.id, duplicate: outcome === 'duplicate' });
  } catch (err) {
    console.error('[website] insert failed:', err);
    await logIngest(businessId, { source: 'website', outcome: 'error', reason: err.message, http_status: 500, payload: body });
    return res.status(500).json({ ok: false, error: 'Could not save lead' });
  }
});
