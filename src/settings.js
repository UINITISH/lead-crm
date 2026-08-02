/**
 * App settings: a small key/value store for things that used to require
 * editing .env and restarting the server — the duplicate-lead window, the
 * display name shown in the sidebar. Deliberately excludes anything secret
 * (tokens, API keys) — those stay in .env, never round-trip through an API
 * response the admin UI can read.
 */
import { query, one } from './db.js';
import { getDbKind } from './db.js';

/** Known settings and their defaults. Anything not set falls back to this. */
const DEFAULTS = {
  company_name: 'Core Value Realty',
  dedupe_window_days: String(process.env.DEDUPE_WINDOW_DAYS || 30),
};

export async function getSetting(key) {
  const row = await one(`SELECT value FROM app_settings WHERE key = $1`, [key]);
  return row?.value ?? DEFAULTS[key] ?? null;
}

export async function setSetting(key, value) {
  const res = await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()
     RETURNING *`,
    [key, String(value)],
  );
  return res.rows[0];
}

/** All known settings, defaults merged in — what the Settings page renders as a form. */
export async function listSettings() {
  const res = await query(`SELECT key, value FROM app_settings`);
  const stored = Object.fromEntries(res.rows.map((r) => [r.key, r.value]));
  return { ...DEFAULTS, ...stored };
}

/**
 * Which lead sources are wired up, and the exact URLs to paste into each
 * platform's dashboard. Presence-only booleans — never returns the actual
 * secret values.
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

export async function getDataStats() {
  const counts = await one(
    `SELECT
        (SELECT COUNT(*) FROM leads)      AS leads,
        (SELECT COUNT(*) FROM leads WHERE is_test) AS test_leads,
        (SELECT COUNT(*) FROM developers) AS developers,
        (SELECT COUNT(*) FROM projects)   AS projects,
        (SELECT COUNT(*) FROM deals)      AS deals,
        (SELECT COUNT(*) FROM follow_ups) AS follow_ups,
        (SELECT COUNT(*) FROM ingest_log) AS ingest_log_rows`,
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
export async function wipeTestLeads() {
  const res = await query(`DELETE FROM leads WHERE is_test = TRUE RETURNING id`);
  return res.rowCount;
}
