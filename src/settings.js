/**
 * App settings: a small key/value store for things that used to require
 * editing .env and restarting the server — the duplicate-lead window, the
 * display name shown in the sidebar. Deliberately excludes anything secret
 * (tokens, API keys) — those stay in .env, never round-trip through an API
 * response the admin UI can read.
 *
 * Multi-tenant: app_settings' primary key is (business_id, key), not just
 * `key` — every business has its own company_name, its own dedupe window.
 */
import { query, one } from './db.js';
import { getDbKind } from './db.js';

/** Known settings and their defaults. Anything not set falls back to this. */
const DEFAULTS = {
  company_name: 'Core Value Realty',
  dedupe_window_days: String(process.env.DEDUPE_WINDOW_DAYS || 30),
};

export async function getSetting(businessId, key) {
  const row = await one(`SELECT value FROM app_settings WHERE business_id = $1 AND key = $2`, [businessId, key]);
  return row?.value ?? DEFAULTS[key] ?? null;
}

export async function setSetting(businessId, key, value) {
  const res = await query(
    `INSERT INTO app_settings (business_id, key, value, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (business_id, key) DO UPDATE SET value = $3, updated_at = now()
     RETURNING *`,
    [businessId, key, String(value)],
  );
  return res.rows[0];
}

/** All known settings for this business, defaults merged in — what the Settings page renders as a form. */
export async function listSettings(businessId) {
  const res = await query(`SELECT key, value FROM app_settings WHERE business_id = $1`, [businessId]);
  const stored = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

/**
 * Which lead sources are wired up, and the exact URLs to paste into each
 * platform's dashboard. Presence-only booleans — never returns the actual
 * secret values.
 *
 * NOTE: the Meta/Google webhook credentials themselves (META_VERIFY_TOKEN
 * etc.) are still a single global .env-level config, not yet per-business —
 * only one client's Meta/Google ad account can be wired up at a time. The
 * website form embed (lead_forms) IS fully per-business already.
 */
export function getIntegrationStatus(req) {
  const base = `${req.protocol}://${req.get('host')}`;
  return {
    website: {
      configured: Boolean(process.env.WEBSITE_INGEST_SECRET),
      webhook_url: `${base}/api/leads/website`,
    },
    google: {
      configured: Boolean(process.env.GOOGLE_WEBHOOK_KEY),
      webhook_url: `${base}/api/leads/google/webhook`,
    },
    meta: {
      configured: Boolean(
        process.env.META_VERIFY_TOKEN && process.env.META_APP_SECRET && process.env.META_PAGE_ACCESS_TOKEN,
      ),
      verify_token_set: Boolean(process.env.META_VERIFY_TOKEN),
      app_secret_set: Boolean(process.env.META_APP_SECRET),
      page_access_token_set: Boolean(process.env.META_PAGE_ACCESS_TOKEN),
      webhook_url: `${base}/api/leads/meta/webhook`,
      handshake_url: `${base}/api/leads/meta/webhook?hub.mode=subscribe&hub.verify_token=<yours>&hub.challenge=1`,
    },
    healthz_url: `${base}/healthz`,
  };
}

export async function getDataStats(businessId) {
  const counts = await one(
    `SELECT
        (SELECT COUNT(*) FROM leads WHERE business_id = $1)      AS leads,
        (SELECT COUNT(*) FROM leads WHERE business_id = $1 AND is_test) AS test_leads,
        (SELECT COUNT(*) FROM developers) AS developers,
        (SELECT COUNT(*) FROM projects)   AS projects,
        (SELECT COUNT(*) FROM deals WHERE business_id = $1)      AS deals,
        (SELECT COUNT(*) FROM follow_ups WHERE business_id = $1) AS follow_ups,
        (SELECT COUNT(*) FROM ingest_log WHERE business_id = $1) AS ingest_log_rows`,
    [businessId],
  );
  return {
    leads: Number(counts.leads),
    test_leads: Number(counts.test_leads),
    developers: Number(counts.developers),
    projects: Number(counts.projects),
    deals: Number(counts.deals),
    follow_ups: Number(counts.follow_ups),
    ingest_log_rows: Number(counts.ingest_log_rows),
    db_kind: await getDbKind(),
  };
}

/** Deletes leads flagged is_test (Google's "Send test data", etc). Real leads are untouched. */
export async function wipeTestLeads(businessId) {
  const res = await query(`DELETE FROM leads WHERE business_id = $1 AND is_test = TRUE RETURNING id`, [businessId]);
  return res.rowCount;
}
