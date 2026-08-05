/**
 * Google Ads Lead Form integration — NATIVE WEBHOOK, no Zapier.
 *
 * POST /api/leads/google/webhook
 *
 * The spec budgeted 2–3 days for a Zapier/Make bridge. You don't need one.
 * Google Ads lead form assets have a built-in "Webhook integration" section:
 * you paste a Webhook URL and a Webhook Key, and Google POSTs each submission
 * straight to you, echoing the key back in the payload as `google_key` so you
 * can reject anything that isn't from Google.
 *
 * Removing the bridge removes a monthly subscription, a third party holding
 * your client's PII, and a failure mode you can't debug.
 *
 * Docs:
 *   https://developers.google.com/google-ads/webhook/docs/overview
 *   https://support.google.com/google-ads/answer/16729613
 *
 * Payload shape:
 * {
 *   "lead_id": "...",
 *   "user_column_data": [
 *     { "column_id": "FULL_NAME", "string_value": "...", "column_name": "Full name" },
 *     { "column_id": "PHONE_NUMBER", "string_value": "+919876543210" }
 *   ],
 *   "api_version": "1.0",
 *   "form_id": 123, "campaign_id": 456, "gcl_id": "...",
 *   "adgroup_id": 789, "creative_id": 1011,
 *   "google_key": "the key you configured",
 *   "is_test": true|false
 * }
 *
 * Note `is_test` — Google's "Send test data" button sets it. Store those rows
 * but flag them, or your first client report will include your own testing.
 */
import express from 'express';
import { insertLead, logIngest } from '../leads.js';
import { getDefaultBusinessId } from '../auth.js';
import { normalizePhone, normalizeEmail, cleanText } from '../normalize.js';

export const googleRouter = express.Router();

googleRouter.post('/google/webhook', async (req, res) => {
  const body = req.body || {};
  const businessId = await getDefaultBusinessId();

  const expected = process.env.GOOGLE_WEBHOOK_KEY;
  if (!expected || body.google_key !== expected) {
    await logIngest(businessId, { source: 'google', outcome: 'rejected', reason: 'bad google_key', http_status: 401, payload: body });
    return res.status(401).json({ ok: false });
  }

  const fields = mapColumns(body.user_column_data || []);

  const phone_e164 = normalizePhone(fields.phone_number);
  if (!phone_e164) {
    await logIngest(businessId, { source: 'google', outcome: 'rejected', reason: 'invalid/absent phone', http_status: 200, payload: body });
    // 200 on purpose: Google retries non-2xx, and retrying won't fix a bad
    // phone number. We've logged it; move on.
    return res.status(200).json({ ok: true, stored: false });
  }

  try {
    const { lead, outcome } = await insertLead(businessId, {
      full_name: cleanText(
        fields.full_name ?? [fields.first_name, fields.last_name].filter(Boolean).join(' '), 200,
      ),
      phone_raw:    cleanText(fields.phone_number, 50),
      phone_e164,
      email:        normalizeEmail(fields.email),
      budget_range: cleanText(fields.budget ?? fields.budget_range, 100),
      timeline:     cleanText(fields.timeline, 100),

      source:           'google',
      platform_lead_id: body.lead_id ? String(body.lead_id) : null,

      campaign_id: body.campaign_id ? String(body.campaign_id) : null,
      adset_id:    body.adgroup_id  ? String(body.adgroup_id)  : null,  // ad group
      ad_id:       body.creative_id ? String(body.creative_id) : null,
      form_id:     body.form_id     ? String(body.form_id)     : null,

      gclid:        cleanText(body.gcl_id, 300),
      utm_source:   'google',
      utm_medium:   'cpc',

      is_test:      Boolean(body.is_test),
      raw_payload:  body,
      submitted_at: new Date().toISOString(),
    });

    await logIngest(businessId, { source: 'google', outcome, lead_id: lead.id, http_status: 200, payload: body });
    return res.status(200).json({ ok: true, lead_id: lead.id });
  } catch (err) {
    console.error('[google] insert failed:', err);
    await logIngest(businessId, { source: 'google', outcome: 'error', reason: err.message, http_status: 500, payload: body });
    // 5xx here IS worth a retry — the lead was valid, our DB blinked.
    return res.status(500).json({ ok: false });
  }
});

const COLUMN_ALIASES = {
  FULL_NAME: 'full_name',
  FIRST_NAME: 'first_name',
  LAST_NAME: 'last_name',
  EMAIL: 'email',
  PHONE_NUMBER: 'phone_number',
  POSTAL_CODE: 'postal_code',
  CITY: 'city',
  COMPANY_NAME: 'company_name',
};

function mapColumns(cols) {
  const out = {};
  for (const c of cols) {
    const id = String(c.column_id || '').toUpperCase();
    const key = COLUMN_ALIASES[id] || id.toLowerCase();
    out[key] = c.string_value;
  }
  return out;
}
