/**
 * Meta Lead Ads integration.
 *
 *   GET  /api/leads/meta/webhook  — subscription verification handshake
 *   POST /api/leads/meta/webhook  — leadgen event; we fetch the full lead
 *
 * Two things that sink most first attempts:
 *
 * 1. Meta's reviewers hit your webhook DURING app review. A 404, a timeout, or
 *    a failed handshake is an instant rejection and you restart the clock. Get
 *    this endpoint live on a real HTTPS domain before you submit.
 * 2. Meta retries on any non-2xx. So: ACK immediately with 200, then process
 *    asynchronously. If you fetch the Graph API inline and it's slow, Meta
 *    times out, retries, and you get duplicate leads.
 */
import express from 'express';
import crypto from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { insertLead, logIngest } from '../leads.js';
import { getDefaultBusinessId } from '../auth.js';
import { normalizePhone, normalizeEmail, cleanText } from '../normalize.js';

/**
 * On a normal long-running server (Render, a VPS) a plain fire-and-forget
 * promise after res.sendStatus(200) keeps running fine — the process stays
 * alive regardless. On Vercel's serverless runtime, the function can be
 * frozen the instant the response is sent, silently killing that work
 * mid-flight. If we're actually running on Vercel (process.env.VERCEL is set
 * by their platform), tell it to keep the function alive until `promise`
 * settles via @vercel/functions' waitUntil; everywhere else this is a no-op
 * and behaviour is unchanged from before.
 */
function runInBackground(promise) {
  if (process.env.VERCEL) waitUntil(promise);
}

export const metaRouter = express.Router();

const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v21.0'}`;

// --- subscription handshake -------------------------------------------------
metaRouter.get('/meta/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// --- payload authenticity ---------------------------------------------------
function verifyMetaSignature(req) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) return false;

  const header = req.get('X-Hub-Signature-256') || '';
  if (!header.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.rawBody || '')
    .digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- webhook ----------------------------------------------------------------
metaRouter.post('/meta/webhook', async (req, res) => {
  const businessId = await getDefaultBusinessId();

  if (!verifyMetaSignature(req)) {
    await logIngest(businessId, { source: 'meta', outcome: 'rejected', reason: 'bad X-Hub-Signature-256', http_status: 401, payload: req.body });
    return res.sendStatus(401);
  }

  // ACK first. Everything below happens after Meta has hung up.
  res.sendStatus(200);

  const body = req.body || {};
  const jobs = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field !== 'leadgen') continue;
      jobs.push(change.value);
    }
  }

  for (const value of jobs) {
    const job = processLeadgen(value, undefined, businessId).catch((err) => {
      console.error('[meta] processing failed:', err);
      logIngest(businessId, { source: 'meta', outcome: 'error', reason: err.message, payload: value });
    });
    runInBackground(job);
  }
});

/**
 * Given a leadgen event, pull the full record from the Graph API and store it.
 * Exported so scripts/e2e.js can drive it with a stubbed fetcher.
 */
export async function processLeadgen(value, fetchLead = fetchLeadFromGraph, businessId = null) {
  if (!businessId) businessId = await getDefaultBusinessId();

  const leadgenId = value?.leadgen_id;
  if (!leadgenId) {
    await logIngest(businessId, { source: 'meta', outcome: 'rejected', reason: 'no leadgen_id', payload: value });
    return null;
  }

  const detail = await fetchLead(leadgenId);
  const fields = mapFieldData(detail.field_data || []);

  const phone_e164 = normalizePhone(fields.phone_number ?? fields.phone ?? fields.mobile_number);
  if (!phone_e164) {
    await logIngest(businessId, { source: 'meta', outcome: 'rejected', reason: 'invalid/absent phone', payload: detail });
    return null;
  }

  const { lead, outcome } = await insertLead(businessId, {
    full_name:    cleanText(fields.full_name ?? [fields.first_name, fields.last_name].filter(Boolean).join(' '), 200),
    phone_raw:    cleanText(fields.phone_number ?? fields.phone ?? fields.mobile_number, 50),
    phone_e164,
    email:        normalizeEmail(fields.email),
    budget_range: cleanText(fields.budget ?? fields.budget_range, 100),
    timeline:     cleanText(fields.timeline ?? fields.when_are_you_looking_to_buy, 100),

    source:           'meta',
    platform_lead_id: String(leadgenId),

    campaign_id:   detail.campaign_id   ? String(detail.campaign_id)   : null,
    campaign_name: cleanText(detail.campaign_name, 300),
    adset_id:      detail.adset_id      ? String(detail.adset_id)      : null,
    adset_name:    cleanText(detail.adset_name, 300),
    ad_id:         detail.ad_id         ? String(detail.ad_id)         : null,
    ad_name:       cleanText(detail.ad_name, 300),
    form_id:       detail.form_id       ? String(detail.form_id)       : (value.form_id ? String(value.form_id) : null),
    form_name:     cleanText(detail.form_name, 300),

    utm_source:   'facebook',
    utm_medium:   'paid_social',
    utm_campaign: cleanText(detail.campaign_name, 300),

    is_test:      Boolean(detail.is_organic === false && detail.__test),
    raw_payload:  { webhook: value, graph: detail },
    submitted_at: detail.created_time || new Date().toISOString(),
  });

  await logIngest(businessId, { source: 'meta', outcome, lead_id: lead.id, payload: detail });
  return lead;
}

/**
 * Ask the Graph API for the lead plus its ad hierarchy.
 * The `fields` list is the part people forget — without campaign_name/ad_name
 * you get a lead you cannot attribute, which defeats the purpose.
 */
async function fetchLeadFromGraph(leadgenId) {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('META_PAGE_ACCESS_TOKEN not configured');

  const fields = [
    'id', 'created_time', 'field_data', 'is_organic',
    'ad_id', 'ad_name', 'adset_id', 'adset_name',
    'campaign_id', 'campaign_name', 'form_id',
  ].join(',');

  const url = `${GRAPH()}/${leadgenId}?fields=${fields}&access_token=${encodeURIComponent(token)}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Graph API ${r.status}: ${text.slice(0, 500)}`);
  }
  return r.json();
}

function mapFieldData(fieldData) {
  const out = {};
  for (const f of fieldData) {
    const key = String(f.name || '').toLowerCase().replace(/\s+/g, '_');
    out[key] = Array.isArray(f.values) ? f.values[0] : f.values;
  }
  return out;
}
