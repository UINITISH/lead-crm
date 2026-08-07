/**
 * Lead repository. All writes go through here so dedupe, idempotency and the
 * audit trail can't be bypassed by a new route someone adds in Phase 2.
 *
 * Multi-tenant: every exported function takes `businessId` as its FIRST
 * parameter, on purpose — burying a tenant-scope key inside an options
 * object makes it easy to forget on some new call site six months from now;
 * a mandatory leading positional argument doesn't. Every query in this file
 * filters or inserts on it. There is no "give me all leads" query left
 * anywhere — that would be a cross-tenant data leak by construction.
 */
import { query, one } from './db.js';
import { getSetting } from './settings.js';

/**
 * Window in which a repeat submission from the same number is a duplicate.
 * Editable from Settings without a restart; falls back to .env, then 30.
 */
async function dedupeWindowDays(businessId) {
  const v = await getSetting(businessId, 'dedupe_window_days');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

const COLUMNS = [
  'business_id',
  'full_name', 'phone_raw', 'phone_e164', 'email', 'budget_range', 'budget_min', 'budget_max', 'timeline',
  'project_id', 'developer_name', 'project_name', 'source', 'platform_lead_id',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'form_id', 'form_name',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid',
  'landing_page', 'referrer', 'first_touch',
  'is_duplicate', 'duplicate_of', 'is_test',
  'entry_method', 'created_by',
  'raw_payload', 'submitted_at',
];

const JSON_COLUMNS = new Set(['first_touch', 'raw_payload']);

/**
 * Insert a lead.
 *
 * Returns { lead, outcome } where outcome is:
 *   'accepted'   — new unique lead
 *   'duplicate'  — same person seen recently; row still stored, flagged
 *   'replayed'   — same platform_lead_id already ingested; nothing written
 *
 * 'replayed' matters because Meta retries its webhook on any non-200 and will
 * happily send you the same leadgen_id several times.
 */
export async function insertLead(businessId, input) {
  // 1. Idempotency on the platform's own ID — scoped per business, so two
  // different clients each running their own Meta account can't collide.
  if (input.platform_lead_id) {
    const existing = await one(
      `SELECT * FROM leads WHERE business_id = $1 AND source = $2 AND platform_lead_id = $3`,
      [businessId, input.source, input.platform_lead_id],
    );
    if (existing) return { lead: existing, outcome: 'replayed' };
  }

  // 2. Human-level dedupe on the normalised phone number, within this business only.
  let duplicateOf = null;
  if (input.phone_e164) {
    const windowDays = await dedupeWindowDays(businessId);
    const prior = await one(
      `SELECT id FROM leads
        WHERE business_id = $1
          AND phone_e164 = $2
          AND is_duplicate = FALSE
          AND created_at > now() - ($3 || ' days')::interval
        ORDER BY created_at ASC
        LIMIT 1`,
      [businessId, input.phone_e164, String(windowDays)],
    );
    if (prior) duplicateOf = prior.id;
  }

  const row = {
    ...input,
    business_id: businessId,
    is_duplicate: Boolean(duplicateOf),
    duplicate_of: duplicateOf,
  };

  const cols = COLUMNS.filter((c) => row[c] !== undefined);
  const params = cols.map((c) =>
    JSON_COLUMNS.has(c) ? JSON.stringify(row[c] ?? {}) : (row[c] ?? null),
  );
  const placeholders = cols.map((_, i) => `$${i + 1}`);

  const res = await query(
    `INSERT INTO leads (${cols.join(', ')}) VALUES (${placeholders.join(', ')})
     RETURNING *`,
    params,
  );
  const lead = res.rows[0];

  const capturedNote = lead.entry_method === 'manual'
    ? `Manually entered · source: ${lead.source}`
    : `Captured from ${lead.source}`;
  await addEvent(businessId, lead.id, {
    event_type: 'created',
    to_status: 'new',
    note: duplicateOf ? `Duplicate of ${duplicateOf}` : capturedNote,
    actor: lead.entry_method === 'manual' ? (lead.created_by || 'admin') : 'system',
  });

  return { lead, outcome: duplicateOf ? 'duplicate' : 'accepted' };
}

/**
 * lead_events has no business_id of its own — it's reached through lead_id,
 * and every write here first confirms that lead actually belongs to
 * `businessId` before touching anything, so a guessed/leaked UUID from
 * another business's lead can never get an event attached (or read back —
 * see getLead()).
 */
export async function addEvent(businessId, leadId, { event_type, from_status = null, to_status = null, note = null, actor = 'system' }) {
  const owns = await one(`SELECT id FROM leads WHERE id = $1 AND business_id = $2`, [leadId, businessId]);
  if (!owns) return false;
  await query(
    `INSERT INTO lead_events (lead_id, event_type, from_status, to_status, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, event_type, from_status, to_status, note, actor],
  );
  return true;
}

/**
 * Fields a rep can edit after a lead already exists. Phone and source are
 * included deliberately — call-ins get numbers mistyped and a lead's true
 * channel sometimes only becomes clear after the fact — but campaign-level
 * attribution (campaign_id, adset, gclid, etc.) stays off this list: that's
 * what proves ad performance and is only ever set at ingestion time, never
 * edited after the fact. `tag` (Warm/Cold/Junk/Scheduled/…) is a separate,
 * informational classification independent of `status` — the pipeline stage
 * (pickup/closed/not_interested) that drives the
 * dashboard funnel and deal eligibility stays untouched by this list, on
 * purpose, and is changed only via updateStatus(). `assigned_emails` is who
 * this lead is assigned to, stored as email addresses (see leads.assigned_emails
 * in db/schema.sql) — validated against Settings → Team at the route level
 * (see PATCH /leads/:id in admin.js), not here.
 */
const EDITABLE_LEAD_FIELDS = [
  'full_name', 'email', 'phone_raw', 'phone_e164', 'source',
  'budget_range', 'budget_min', 'budget_max', 'timeline',
  'developer_name', 'project_name', 'tag', 'assigned_emails',
];

/**
 * Partial update. Returns { before, after } so the caller can write a
 * human-readable "what changed" note into the lead's activity thread —
 * returns null if the lead doesn't exist OR doesn't belong to this business.
 */
export async function updateLead(businessId, leadId, fields = {}) {
  const current = await one(`SELECT * FROM leads WHERE id = $1 AND business_id = $2`, [leadId, businessId]);
  if (!current) return null;

  const keys = EDITABLE_LEAD_FIELDS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return { before: current, after: current };

  const sets = keys.map((k, i) => `${k} = $${i + 3}`);
  const params = [leadId, businessId, ...keys.map((k) => fields[k])];
  const res = await query(
    `UPDATE leads SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND business_id = $2 RETURNING *`,
    params,
  );
  return { before: current, after: res.rows[0] };
}

/**
 * Hard delete. lead_events/deals/follow_ups all cascade (ON DELETE CASCADE),
 * so nothing is left orphaned. Returns false if the lead was already gone,
 * or belongs to a different business.
 */
export async function deleteLead(businessId, leadId) {
  const res = await query(`DELETE FROM leads WHERE id = $1 AND business_id = $2 RETURNING id`, [leadId, businessId]);
  return res.rows.length > 0;
}

export async function updateStatus(businessId, leadId, newStatus, { actor = 'user', note = null } = {}) {
  const current = await one(`SELECT status FROM leads WHERE id = $1 AND business_id = $2`, [leadId, businessId]);
  if (!current) return null;
  if (current.status === newStatus && !note) return current;

  const res = await query(
    `UPDATE leads SET status = $3 WHERE id = $1 AND business_id = $2 RETURNING *`,
    [leadId, businessId, newStatus],
  );
  await addEvent(businessId, leadId, {
    event_type: 'status_change',
    from_status: current.status,
    to_status: newStatus,
    note,
    actor,
  });
  return res.rows[0];
}

function buildLeadWhere(businessId, filters) {
  const params = [businessId];
  const where = ['l.business_id = $1'];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (filters.source)        add('source = ?', filters.source);
  if (filters.status)        add('status = ?', filters.status);
  if (filters.tag)           add('tag = ?', filters.tag);
  if (filters.campaign_id)   add('campaign_id = ?', filters.campaign_id);
  if (filters.entry_method)  add('entry_method = ?', filters.entry_method);
  if (filters.developer_name) add('developer_name = ?', filters.developer_name);
  if (filters.assigned_email) add('? = ANY(assigned_emails)', filters.assigned_email);
  if (filters.from)          add('created_at >= ?', filters.from);
  if (filters.to)            add('created_at <= ?', filters.to);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(full_name ILIKE ${p} OR phone_e164 ILIKE ${p} OR email ILIKE ${p})`);
  }
  if (!filters.include_duplicates) where.push('is_duplicate = FALSE');
  if (!filters.include_test)       where.push('is_test = FALSE');

  return { params, whereSql: where.join(' AND ') };
}

export async function listLeads(businessId, filters = {}) {
  const { params, whereSql } = buildLeadWhere(businessId, filters);

  const sql = `SELECT l.*,
      (1 + (SELECT COUNT(*) FROM leads d WHERE d.duplicate_of = l.id AND d.business_id = l.business_id))::int AS occurrence_count
    FROM leads l
    WHERE ${whereSql}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Number(filters.limit) || 5000, 20_000)}
    OFFSET ${Number(filters.offset) || 0}`;

  const res = await query(sql, params);
  return res.rows;
}

export async function getLead(businessId, id) {
  // Marks the lead "viewed" the first time anyone opens it — COALESCE means
  // a second, third, ... open() never overwrites the original viewed_at.
  // This is what un-bolds a lead in the Leads table (see leads.viewed_at in
  // db/schema.sql): nobody has to click a separate "mark as read" button,
  // opening the drawer at all is the signal that someone looked at it.
  const lead = await one(
    `UPDATE leads SET viewed_at = COALESCE(viewed_at, now())
       WHERE id = $1 AND business_id = $2
     RETURNING *`,
    [id, businessId],
  );
  if (!lead) return null;
  const events = await query(
    `SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY created_at ASC`, [id],
  );
  const duplicates = await listDuplicatesOf(businessId, id);
  return { ...lead, events: events.rows, duplicates, occurrence_count: 1 + duplicates.length };
}

/**
 * Every repeat submission from the same person, folded into this lead at
 * intake time (see insertLead's phone-number dedupe). Surfaced in the lead
 * drawer so a rep can see someone enquired more than once without that
 * inflating the headline lead count.
 */
export async function listDuplicatesOf(businessId, leadId) {
  const res = await query(
    `SELECT id, full_name, phone_raw, phone_e164, source, form_name, campaign_name, created_at
       FROM leads WHERE duplicate_of = $1 AND business_id = $2 ORDER BY created_at ASC`,
    [leadId, businessId],
  );
  return res.rows;
}

/**
 * Source breakdown. This is the number you put in front of the client.
 * Duplicates and test leads are excluded by default — report the honest figure,
 * and keep the gross figure available so you can explain the gap.
 */
export async function sourceReport(businessId, { from = null, to = null } = {}) {
  const params = [businessId];
  const where = ['business_id = $1', 'is_test = FALSE'];
  if (from) { params.push(from); where.push(`created_at >= $${params.length}`); }
  if (to)   { params.push(to);   where.push(`created_at <= $${params.length}`); }
  const clause = `WHERE ${where.join(' AND ')}`;

  const res = await query(
    `SELECT
        source,
        COALESCE(campaign_name, campaign_id, '(not set)') AS campaign,
        COUNT(*) FILTER (WHERE is_duplicate = FALSE)            AS unique_leads,
        COUNT(*)                                               AS gross_leads,
        COUNT(*) FILTER (WHERE status <> 'pickup' AND is_duplicate = FALSE) AS contacted_plus,
        COUNT(*) FILTER (WHERE tag ILIKE '%site%visit%' AND is_duplicate = FALSE) AS site_visits,
        COUNT(*) FILTER (WHERE status = 'closed' AND is_duplicate = FALSE)     AS closed
     FROM leads
     ${clause}
     GROUP BY source, campaign
     ORDER BY unique_leads DESC`,
    params,
  );
  return res.rows;
}

/** Recent lifecycle events across every lead, for the dashboard activity feed. */
export async function listRecentActivity(businessId, { limit = 15 } = {}) {
  const res = await query(
    `SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.actor, e.created_at,
            l.id AS lead_id, l.full_name, l.phone_e164
       FROM lead_events e
       JOIN leads l ON l.id = e.lead_id
      WHERE l.business_id = $1
      ORDER BY e.created_at DESC
      LIMIT $2`,
    [businessId, Math.min(Number(limit) || 15, 100)],
  );
  return res.rows;
}

/**
 * Who's actually working leads. Approximate until real per-staff accounts
 * exist (today, one login per business) — `actor` is only as accurate as
 * whatever name someone typed into "Acting as" for their session, but that's
 * still real attribution, not a guess.
 */
export async function leaderboard(businessId) {
  const res = await query(
    `SELECT actor,
            COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'status_change')                          AS leads_worked,
            COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'closed')                 AS leads_closed,
            COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'created')                                  AS leads_added
       FROM lead_events e
       JOIN leads l ON l.id = e.lead_id
      WHERE l.business_id = $1 AND e.actor IS NOT NULL AND e.actor <> 'system'
      GROUP BY actor
      ORDER BY leads_closed DESC, leads_worked DESC
      LIMIT 10`,
    [businessId],
  );
  return res.rows;
}

const BUDGET_MIDPOINT = `CASE WHEN budget_min IS NOT NULL OR budget_max IS NOT NULL
  THEN (COALESCE(budget_min, budget_max) + COALESCE(budget_max, budget_min)) / 2.0 ELSE NULL END`;

/**
 * Everything the dashboard needs in one round trip: headline stats with a
 * month-over-month trend, pipeline stage breakdown (count + ₹ value), and an
 * 8-week value trend. Values are in ₹ lakhs (see budget_min/budget_max).
 */
export async function dashboardStats(businessId) {
  const base = `business_id = $1 AND is_duplicate = FALSE AND is_test = FALSE`;

  const totals = await one(
    `SELECT
        COUNT(*) FILTER (WHERE ${base})                                                   AS total,
        COUNT(*) FILTER (WHERE ${base} AND created_at >= date_trunc('month', now()))       AS this_month,
        COUNT(*) FILTER (WHERE ${base} AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now()))        AS last_month,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','not_interested'))              AS open_pipeline,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','not_interested')
                                       AND created_at >= date_trunc('month', now()))         AS open_this_month,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','not_interested')
                                       AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now()))         AS open_last_month,
        COUNT(*) FILTER (WHERE ${base} AND status = 'closed')                               AS closed_total,
        COALESCE(SUM(${BUDGET_MIDPOINT}) FILTER (WHERE ${base} AND status NOT IN ('closed','not_interested')), 0) AS pipeline_value,
        COALESCE(SUM(${BUDGET_MIDPOINT}) FILTER (WHERE ${base} AND status NOT IN ('closed','not_interested')
                                       AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now())), 0)     AS pipeline_value_last_month
     FROM leads
     WHERE business_id = $1`,
    [businessId],
  );

  const stageRows = await query(
    `SELECT status,
            COUNT(*)                                    AS n,
            COALESCE(SUM(${BUDGET_MIDPOINT}), 0)         AS value
       FROM leads
      WHERE ${base}
      GROUP BY status`,
    [businessId],
  );
  const stages = ['pickup', 'closed', 'not_interested'].map((s) => {
    const row = stageRows.rows.find((r) => r.status === s);
    return { status: s, n: row ? Number(row.n) : 0, value: row ? Number(row.value) : 0 };
  });

  const trend = await query(
    `SELECT date_trunc('week', created_at) AS week,
            COUNT(*)                                    AS n,
            COALESCE(SUM(${BUDGET_MIDPOINT}), 0)         AS value
       FROM leads
      WHERE ${base} AND created_at >= now() - interval '8 weeks'
      GROUP BY week
      ORDER BY week`,
    [businessId],
  );

  const pct = (now, prev) => {
    now = Number(now); prev = Number(prev);
    if (prev === 0) return now > 0 ? 100 : 0;
    return Math.round(((now - prev) / prev) * 1000) / 10;
  };

  return {
    total_leads: Number(totals.total),
    total_leads_trend: pct(totals.this_month, totals.last_month),
    open_pipeline: Number(totals.open_pipeline),
    open_pipeline_trend: pct(totals.open_this_month, totals.open_last_month),
    pipeline_value: Number(totals.pipeline_value),
    pipeline_value_trend: pct(totals.pipeline_value, totals.pipeline_value_last_month),
    conversion_rate: totals.total > 0 ? Math.round((totals.closed_total / totals.total) * 1000) / 10 : 0,
    stages,
    value_trend: trend.rows.map((r) => ({ week: r.week, n: Number(r.n), value: Number(r.value) })),
  };
}

export async function logIngest(businessId, { source, outcome, reason = null, lead_id = null, http_status = null, payload = null }) {
  try {
    await query(
      `INSERT INTO ingest_log (business_id, source, outcome, reason, lead_id, http_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [businessId, source, outcome, reason, lead_id, http_status, JSON.stringify(payload ?? {})],
    );
  } catch (e) {
    // Logging must never break ingestion.
    console.error('[ingest_log] write failed:', e.message);
  }
}
