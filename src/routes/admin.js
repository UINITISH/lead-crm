/**
 * Admin API behind a shared bearer token.
 *
 * Phase 1 only. Before Phase 2 ships to Core Realty's sales team, replace this
 * with per-user accounts — a shared token means you cannot tell who changed a
 * lead's status, which makes the audit trail worthless the moment it matters.
 */
import express from 'express';
import { listLeads, getLead, updateStatus, sourceReport } from '../leads.js';
import { query as raw } from '../db.js';

export const adminRouter = express.Router();

// Resolve the token once, at boot, so the behaviour is obvious in the logs
// rather than surfacing as a mystery 401 in the browser.
const IS_PROD = process.env.NODE_ENV === 'production';
let ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
  if (IS_PROD) {
    // Refuse to run. An admin API with no credential is worse than a crash.
    console.error('[admin] ADMIN_TOKEN is not set. Refusing to start in production.');
    process.exit(1);
  }
  ADMIN_TOKEN = 'local-preview';
  console.warn(
    '[admin] No ADMIN_TOKEN in .env — using the development default "local-preview".\n' +
    '[admin] Set a real one before this is reachable by anyone else.',
  );
}

/**
 * Local convenience: when we're running on the development default token,
 * hand it to the UI so nobody has to type it. Deliberately gated twice —
 * NOT production, AND the token is still the well-known default. Set a real
 * ADMIN_TOKEN and this endpoint stops existing.
 */
export const USING_DEV_DEFAULT = !IS_PROD && ADMIN_TOKEN === 'local-preview';

adminRouter.get('/dev-token', (_req, res) => {
  if (!USING_DEV_DEFAULT) return res.status(404).json({ ok: false });
  res.json({ ok: true, token: ADMIN_TOKEN });
});

adminRouter.use((req, res, next) => {
  const given = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    || req.query.token;
  if (given !== ADMIN_TOKEN) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  next();
});

adminRouter.get('/leads', async (req, res) => {
  const rows = await listLeads({
    source: req.query.source,
    status: req.query.status,
    campaign_id: req.query.campaign_id,
    from: req.query.from,
    to: req.query.to,
    q: req.query.q,
    include_duplicates: req.query.include_duplicates === '1',
    include_test: req.query.include_test === '1',
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json({ ok: true, count: rows.length, leads: rows });
});

adminRouter.get('/leads/:id', async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, lead });
});

adminRouter.patch('/leads/:id/status', async (req, res) => {
  const { status, note, actor } = req.body || {};
  const allowed = ['new', 'contacted', 'site_visit', 'negotiation', 'closed', 'dropped'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: `status must be one of ${allowed.join(', ')}` });
  }
  const lead = await updateStatus(req.params.id, status, { actor: actor || 'admin', note });
  if (!lead) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, lead });
});

adminRouter.get('/report/source', async (req, res) => {
  const rows = await sourceReport({ from: req.query.from, to: req.query.to });
  res.json({ ok: true, rows });
});

/** Reconciliation view: what came in, what we kept, and why we dropped things. */
adminRouter.get('/report/ingest', async (req, res) => {
  const r = await raw(
    `SELECT source, outcome, reason, COUNT(*) AS n
       FROM ingest_log
      WHERE created_at > now() - interval '30 days'
      GROUP BY source, outcome, reason
      ORDER BY n DESC`,
  );
  res.json({ ok: true, rows: r.rows });
});

adminRouter.get('/export.csv', async (req, res) => {
  const rows = await listLeads({
    from: req.query.from, to: req.query.to, source: req.query.source, limit: 10_000,
  });
  const cols = [
    'created_at', 'source', 'campaign_name', 'adset_name', 'ad_name',
    'full_name', 'phone_e164', 'email', 'budget_range', 'timeline',
    'status', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'landing_page',
  ];
  const esc = (v) => {
    if (v == null) return '';
    // Dates must not go out as JS toString ("Fri Jul 31 2026 ... (India Standard
    // Time)") — Excel and Sheets won't parse that. ISO 8601 sorts and imports.
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Guard against CSV formula injection — Excel will execute =, +, -, @.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="core-realty-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});
