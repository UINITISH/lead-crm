/**
 * Admin API behind a shared bearer token.
 *
 * Phase 1 only. Before Phase 2 ships to Core Value Realty's sales team, replace this
 * with per-user accounts — a shared token means you cannot tell who changed a
 * lead's status, which makes the audit trail worthless the moment it matters.
 */
import express from 'express';
import {
  listLeads, getLead, updateStatus, sourceReport, insertLead, logIngest, addEvent,
  listRecentActivity, leaderboard, dashboardStats,
} from '../leads.js';
import { query as raw } from '../db.js';
import {
  listDevelopers, listProjects, findOrCreateDeveloper, findOrCreateProject, seedDeveloperDirectory,
} from '../developers.js';
import {
  createFollowUp, listUpcoming, listForLead, markDone, updateFollowUp,
} from '../followups.js';
import {
  createDeal, listDeals, listForLead as listDealsForLead, getDeal, updateDeal, dealStats,
} from '../deals.js';
import {
  listSettings, setSetting, getIntegrationStatus, getDataStats, wipeTestLeads,
} from '../settings.js';
import { listReps, createRep, updateRep } from '../reps.js';
import { normalizePhone, normalizeEmail, cleanText } from '../normalize.js';

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
    entry_method: req.query.entry_method,
    developer_name: req.query.developer_name,
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

/**
 * Manual lead entry.
 *
 * Exists for two real situations: someone calls in and a lead is logged by
 * hand, or a Meta/Google lead is downloaded as a CSV from the ads dashboard
 * and typed in rather than arriving over the webhook. In both cases `source`
 * is a deliberate choice made by the person entering it, not inferred — so a
 * CSV-uploaded Meta lead still reports as `meta`, same as one that arrived
 * live. Every insert here is flagged entry_method = 'manual' so reporting can
 * always tell manual entries apart from webhook-captured ones.
 */
adminRouter.post('/leads/manual', async (req, res) => {
  const body = req.body || {};
  const SOURCES = ['meta', 'google', 'website'];

  if (!SOURCES.includes(body.source)) {
    return res.status(400).json({ ok: false, error: `source must be one of ${SOURCES.join(', ')}`, field: 'source' });
  }

  const phone_e164 = normalizePhone(body.phone);
  if (!phone_e164) {
    return res.status(400).json({ ok: false, error: 'A valid phone number is required', field: 'phone' });
  }

  // Developer/project: accept an existing id, or a typed name to create on
  // the spot. Neither is required — a lead can be logged before the project
  // is pinned down and edited later.
  let developer = null;
  if (body.developer_id) {
    developer = await raw(`SELECT * FROM developers WHERE id = $1`, [body.developer_id]).then((r) => r.rows[0]);
    if (!developer) return res.status(400).json({ ok: false, error: 'Unknown developer_id', field: 'developer_id' });
  } else if (cleanText(body.developer_name)) {
    const grade = ['A', 'B'].includes(body.developer_grade) ? body.developer_grade : null;
    developer = await findOrCreateDeveloper(body.developer_name, grade);
  }

  let project = null;
  if (body.project_id) {
    project = await raw(`SELECT * FROM projects WHERE id = $1`, [body.project_id]).then((r) => r.rows[0]);
    if (!project) return res.status(400).json({ ok: false, error: 'Unknown project_id', field: 'project_id' });
  } else if (cleanText(body.project_name)) {
    project = await findOrCreateProject(body.project_name, developer?.id ?? null);
  }

  try {
    const { lead, outcome } = await insertLead({
      full_name:    cleanText(body.full_name ?? body.name, 200),
      phone_raw:    cleanText(body.phone, 50),
      phone_e164,
      email:        normalizeEmail(body.email),
      budget_range: cleanText(body.budget_range ?? body.budget, 100),
      budget_min:   toNum(body.budget_min),
      budget_max:   toNum(body.budget_max),
      timeline:     cleanText(body.timeline, 100),
      project_id:      project?.id ?? null,
      developer_name:  developer?.name ?? cleanText(body.developer_name, 200),
      project_name:    project?.name ?? cleanText(body.project_name, 200),
      source: body.source,
      is_test: Boolean(body.is_test),
      entry_method: 'manual',
      created_by: cleanText(body.actor ?? body.created_by, 100) || 'admin',
      raw_payload: body,
      submitted_at: new Date().toISOString(),
    });

    if (cleanText(body.notes)) {
      await addEvent(lead.id, {
        event_type: 'note',
        note: cleanText(body.notes, 2000),
        actor: cleanText(body.actor ?? body.created_by, 100) || 'admin',
      });
    }

    await logIngest({ source: body.source, outcome, lead_id: lead.id, http_status: 201, payload: { ...body, manual: true } });
    return res.status(201).json({ ok: true, lead, duplicate: outcome === 'duplicate' });
  } catch (err) {
    console.error('[admin] manual lead insert failed:', err);
    return res.status(500).json({ ok: false, error: 'Could not save lead' });
  }
});

adminRouter.get('/developers', async (_req, res) => {
  res.json({ ok: true, developers: await listDevelopers() });
});

adminRouter.post('/developers', async (req, res) => {
  const name = (req.body || {}).name;
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const grade = ['A', 'B'].includes((req.body || {}).grade) ? req.body.grade : null;
  const developer = await findOrCreateDeveloper(name, grade);
  res.status(201).json({ ok: true, developer });
});

adminRouter.get('/projects', async (req, res) => {
  res.json({ ok: true, projects: await listProjects({ developer_id: req.query.developer_id || undefined }) });
});

adminRouter.post('/projects', async (req, res) => {
  const { name, developer_id } = req.body || {};
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const project = await findOrCreateProject(name, developer_id || null, req.body || {});
  res.status(201).json({ ok: true, project });
});

/** Dashboard activity feed: recent lifecycle events across every lead. */
adminRouter.get('/activity', async (req, res) => {
  res.json({ ok: true, activity: await listRecentActivity({ limit: req.query.limit }) });
});

/**
 * Who's working leads, ranked. Approximate until real user accounts exist —
 * it's grouped by whatever name was set as "Acting as" for a session, not a
 * verified identity.
 */
adminRouter.get('/leaderboard', async (_req, res) => {
  res.json({ ok: true, leaderboard: await leaderboard() });
});

/** Headline stats, pipeline stage breakdown, and an 8-week value trend, in one call. */
adminRouter.get('/dashboard-stats', async (_req, res) => {
  res.json({ ok: true, stats: await dashboardStats() });
});

/** Upcoming follow-up reminders across all leads. */
adminRouter.get('/followups', async (req, res) => {
  res.json({ ok: true, followups: await listUpcoming({ limit: req.query.limit, includeDone: req.query.include_done === '1' }) });
});

adminRouter.get('/leads/:id/followups', async (req, res) => {
  res.json({ ok: true, followups: await listForLead(req.params.id) });
});

adminRouter.post('/leads/:id/followups', async (req, res) => {
  const { due_at, note, assigned_to, actor } = req.body || {};
  if (!due_at) return res.status(400).json({ ok: false, error: 'due_at is required', field: 'due_at' });
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });

  const followup = await createFollowUp({
    lead_id: req.params.id,
    due_at,
    note: cleanText(note, 500),
    assigned_to: cleanText(assigned_to, 100),
    created_by: cleanText(actor, 100) || 'admin',
  });
  await addEvent(req.params.id, {
    event_type: 'note',
    note: `Follow-up scheduled for ${new Date(due_at).toLocaleString('en-IN')}${note ? ': ' + note : ''}`,
    actor: cleanText(actor, 100) || 'admin',
  });
  res.status(201).json({ ok: true, followup });
});

adminRouter.patch('/followups/:id', async (req, res) => {
  const { done, due_at, note } = req.body || {};
  let followup;
  if (done !== undefined) {
    followup = await markDone(req.params.id, { done: Boolean(done) });
  } else {
    followup = await updateFollowUp(req.params.id, { due_at, note });
  }
  if (!followup) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, followup });
});

/**
 * Deals. Distinct from a lead — a deal only makes sense once a lead has
 * reached negotiation (or later), which is why creation is gated on the
 * lead's current status rather than left to the caller's judgment.
 */
const DEAL_ELIGIBLE_STATUSES = ['negotiation', 'closed'];

adminRouter.get('/deals', async (req, res) => {
  res.json({ ok: true, deals: await listDeals({ stage: req.query.stage, limit: req.query.limit }) });
});

adminRouter.get('/deal-stats', async (_req, res) => {
  res.json({ ok: true, stats: await dealStats() });
});

adminRouter.get('/deals/:id', async (req, res) => {
  const deal = await getDeal(req.params.id);
  if (!deal) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, deal });
});

adminRouter.get('/leads/:id/deals', async (req, res) => {
  res.json({ ok: true, deals: await listDealsForLead(req.params.id) });
});

adminRouter.post('/leads/:id/deals', async (req, res) => {
  const lead = await getLead(req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
  if (!DEAL_ELIGIBLE_STATUSES.includes(lead.status)) {
    return res.status(400).json({
      ok: false,
      error: `A deal can only be opened once the lead reaches negotiation. This lead is at "${lead.status.replace('_', ' ')}".`,
    });
  }

  const { unit_number, agreed_price, expected_closing_date, notes, actor } = req.body || {};
  const deal = await createDeal({
    lead_id: req.params.id,
    unit_number: cleanText(unit_number, 100),
    agreed_price: toNum(agreed_price),
    expected_closing_date: expected_closing_date || null,
    notes: cleanText(notes, 1000),
    created_by: cleanText(actor, 100) || 'admin',
  });
  res.status(201).json({ ok: true, deal });
});

adminRouter.patch('/deals/:id', async (req, res) => {
  const { stage, unit_number, agreed_price, expected_closing_date, notes, actor } = req.body || {};
  try {
    const deal = await updateDeal(req.params.id, {
      stage,
      unit_number: unit_number !== undefined ? cleanText(unit_number, 100) : undefined,
      agreed_price: agreed_price !== undefined ? toNum(agreed_price) : undefined,
      expected_closing_date: expected_closing_date !== undefined ? (expected_closing_date || null) : undefined,
      notes: notes !== undefined ? cleanText(notes, 1000) : undefined,
      actor: cleanText(actor, 100) || 'admin',
    });
    if (!deal) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, deal });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
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
  res.set('Content-Disposition', `attachment; filename="core-value-realty-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

/**
 * Settings.
 *
 * Only a small, deliberate set of keys are editable from here — company_name
 * (shown in the sidebar) and dedupe_window_days (how many days a repeat
 * phone number counts as the same lead). Nothing secret ever lives in
 * app_settings; API keys and tokens stay in .env, edited on the server.
 */
const EDITABLE_SETTINGS = ['company_name', 'dedupe_window_days'];

adminRouter.get('/settings', async (_req, res) => {
  res.json({ ok: true, settings: await listSettings() });
});

adminRouter.patch('/settings', async (req, res) => {
  const body = req.body || {};
  const updates = Object.keys(body).filter((k) => EDITABLE_SETTINGS.includes(k));
  if (!updates.length) {
    return res.status(400).json({ ok: false, error: `No editable settings in request. Allowed: ${EDITABLE_SETTINGS.join(', ')}` });
  }
  if ('dedupe_window_days' in body) {
    const n = Number(body.dedupe_window_days);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ ok: false, error: 'dedupe_window_days must be a positive number', field: 'dedupe_window_days' });
    }
  }
  if ('company_name' in body && !cleanText(body.company_name)) {
    return res.status(400).json({ ok: false, error: 'company_name cannot be blank', field: 'company_name' });
  }
  for (const key of updates) {
    await setSetting(key, body[key]);
  }
  res.json({ ok: true, settings: await listSettings() });
});

/** Which lead sources are wired up (env vars present), and the URLs to paste into each platform. Never exposes secrets. */
adminRouter.get('/integration-status', async (req, res) => {
  res.json({ ok: true, integrations: getIntegrationStatus(req) });
});

/** Row counts across the CRM's core tables, plus which database backend is running. */
adminRouter.get('/data-stats', async (_req, res) => {
  res.json({ ok: true, stats: await getDataStats() });
});

/** Deletes only leads flagged is_test (e.g. Google's "Send test data" button). Real leads are untouched. */
adminRouter.post('/data/wipe-test-leads', async (_req, res) => {
  const deleted = await wipeTestLeads();
  res.json({ ok: true, deleted });
});

/**
 * Re-run the builder/project directory seed. Guarded on an empty developers
 * table (same guard migrate.js uses on boot) — it will NOT overwrite or
 * duplicate a directory that's already populated, so this is safe to click
 * but only does something the first time.
 */
adminRouter.post('/data/reseed-developers', async (_req, res) => {
  const result = await seedDeveloperDirectory();
  res.json({ ok: true, ...result });
});

/**
 * Reps — the shared team list that backs "Acting as" in the UI, replacing a
 * free-text box where the same person could show up under three spellings.
 */
adminRouter.get('/reps', async (req, res) => {
  res.json({ ok: true, reps: await listReps({ activeOnly: req.query.active_only === '1' }) });
});

adminRouter.post('/reps', async (req, res) => {
  const name = (req.body || {}).name;
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const rep = await createRep(name);
  res.status(201).json({ ok: true, rep });
});

adminRouter.patch('/reps/:id', async (req, res) => {
  const { name, is_active } = req.body || {};
  const rep = await updateRep(req.params.id, {
    name: name !== undefined ? name : undefined,
    is_active: is_active !== undefined ? is_active : undefined,
  });
  if (!rep) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, rep });
});
