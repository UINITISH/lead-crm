/**
 * Lead repository. All writes go through here so dedupe, idempotency and the
 * audit trail can't be bypassed by a new route someone adds in Phase 2.
 */
import { query, one } from './db.js';
import { getSetting } from './settings.js';

/**
 * Window in which a repeat submission from the same number is a duplicate.
 * Editable from Settings without a restart; falls back to .env, then 30.
 */
async function dedupeWindowDays() {
  const v = await getSetting('dedupe_window_days');
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

const COLUMNS = [
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
export async function insertLead(input) {
  // 1. Idempotency on the platform's own ID.
  if (input.platform_lead_id) {
    const existing = await one(
      `SELECT * FROM leads WHERE source = $1 AND platform_lead_id = $2`,
      [input.source, input.platform_lead_id],
    );
    if (existing) return { lead: existing, outcome: 'replayed' };
  }

  // 2. Human-level dedupe on the normalised phone number.
  let duplicateOf = null;
  if (input.phone_e164) {
    const windowDays = await dedupeWindowDays();
    const prior = await one(
      `SELECT id FROM leads
        WHERE phone_e164 = $1
          AND is_duplicate = FALSE
          AND created_at > now() - ($2 || ' days')::interval
        ORDER BY created_at ASC
        LIMIT 1`,
      [input.phone_e164, String(windowDays)],
    );
    if (prior) duplicateOf = prior.id;
  }

  const row = {
    ...input,
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
  await addEvent(lead.id, {
    event_type: 'created',
    to_status: 'new',
    note: duplicateOf ? `Duplicate of ${duplicateOf}` : capturedNote,
    actor: lead.entry_method === 'manual' ? (lead.created_by || 'admin') : 'system',
  });

  return { lead, outcome: duplicateOf ? 'duplicate' : 'accepted' };
}

export async function addEvent(leadId, { event_type, from_status = null, to_status = null, note = null, actor = 'system' }) {
  await query(
    `INSERT INTO lead_events (lead_id, event_type, from_status, to_status, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, event_type, from_status, to_status, note, actor],
  );
}

export async function updateStatus(leadId, newStatus, { actor = 'user', note = null } = {}) {
  const current = await one(`SELECT status FROM leads WHERE id = $1`, [leadId]);
  if (!current) return null;
  if (current.status === newStatus && !note) return current;

  const res = await query(
    `UPDATE leads SET status = $2 WHERE id = $1 RETURNING *`,
    [leadId, newStatus],
  );
  await addEvent(leadId, {
    event_type: 'status_change',
    from_status: current.status,
    to_status: newStatus,
    note,
    actor,
  });
  return res.rows[0];
}

export async function listLeads(filters = {}) {
  const where = [];
  const params = [];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (filters.source)        add('source = ?', filters.source);
  if (filters.status)        add('status = ?', filters.status);
  if (filters.campaign_id)   add('campaign_id = ?', filters.campaign_id);
  if (filters.entry_method)  add('entry_method = ?', filters.entry_method);
  if (filters.developer_name) add('developer_name = ?', filters.developer_name);
  if (filters.from)          add('created_at >= ?', filters.from);
  if (filters.to)            add('created_at <= ?', filters.to);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(full_name ILIKE ${p} OR phone_e164 ILIKE ${p} OR email ILIKE ${p})`);
  }
  if (!filters.include_duplicates) where.push('is_duplicate = FALSE');
  if (!filters.include_test)       where.push('is_test = FALSE');

  const sql = `SELECT * FROM leads
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Number(filters.limit) || 200, 1000)}
    OFFSET ${Number(filters.offset) || 0}`;

  const res = await query(sql, params);
  return res.rows;
}

export async function getLead(id) {
  const lead = await one(`SELECT * FROM leads WHERE id = $1`, [id]);
  if (!lead) return null;
  const events = await query(
    `SELECT * FROM lead_events WHERE lead_id = $1 ORDER BY created_at ASC`, [id],
  );
  return { ...lead, events: events.rows };
}

/**
 * Source breakdown. This is the number you put in front of the client.
 * Duplicates and test leads are excluded by default — report the honest figure,
 * and keep the gross figure available so you can explain the gap.
 */
export async function sourceReport({ from = null, to = null } = {}) {
  const params = [];
  const where = [];
  if (from) { params.push(from); where.push(`created_at >= $${params.length}`); }
  if (to)   { params.push(to);   where.push(`created_at <= $${params.length}`); }
  where.push('is_test = FALSE');
  const clause = `WHERE ${where.join(' AND ')}`;

  const res = await query(
    `SELECT
        source,
        COALESCE(campaign_name, campaign_id, '(not set)') AS campaign,
        COUNT(*) FILTER (WHERE is_duplicate = FALSE)            AS unique_leads,
        COUNT(*)                                               AS gross_leads,
        COUNT(*) FILTER (WHERE status <> 'new' AND is_duplicate = FALSE) AS contacted_plus,
        COUNT(*) FILTER (WHERE status = 'site_visit' AND is_duplicate = FALSE) AS site_visits,
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
export async function listRecentActivity({ limit = 15 } = {}) {
  const res = await query(
    `SELECT e.id, e.event_type, e.from_status, e.to_status, e.note, e.actor, e.created_at,
            l.id AS lead_id, l.full_name, l.phone_e164
       FROM lead_events e
       JOIN leads l ON l.id = e.lead_id
      ORDER BY e.created_at DESC
      LIMIT $1`,
    [Math.min(Number(limit) || 15, 100)],
  );
  return res.rows;
}

/**
 * Who's actually working leads. Approximate until Phase 2 adds real user
 * accounts (Phase 1 shares one admin token) — `actor` is only as accurate as
 * whatever name someone typed into "Acting as" for their session, but that's
 * still real attribution, not a guess.
 */
export async function leaderboard() {
  const res = await query(
    `SELECT actor,
            COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'status_change')                          AS leads_worked,
            COUNT(*) FILTER (WHERE event_type = 'status_change' AND to_status = 'closed')                 AS leads_closed,
            COUNT(DISTINCT lead_id) FILTER (WHERE event_type = 'created')                                  AS leads_added
       FROM lead_events
      WHERE actor IS NOT NULL AND actor <> 'system'
      GROUP BY actor
      ORDER BY leads_closed DESC, leads_worked DESC
      LIMIT 10`,
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
export async function dashboardStats() {
  const base = `is_duplicate = FALSE AND is_test = FALSE`;

  const totals = await one(
    `SELECT
        COUNT(*) FILTER (WHERE ${base})                                                   AS total,
        COUNT(*) FILTER (WHERE ${base} AND created_at >= date_trunc('month', now()))       AS this_month,
        COUNT(*) FILTER (WHERE ${base} AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now()))        AS last_month,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','dropped'))              AS open_pipeline,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','dropped')
                                       AND created_at >= date_trunc('month', now()))         AS open_this_month,
        COUNT(*) FILTER (WHERE ${base} AND status NOT IN ('closed','dropped')
                                       AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now()))         AS open_last_month,
        COUNT(*) FILTER (WHERE ${base} AND status = 'closed')                               AS closed_total,
        COALESCE(SUM(${BUDGET_MIDPOINT}) FILTER (WHERE ${base} AND status NOT IN ('closed','dropped')), 0) AS pipeline_value,
        COALESCE(SUM(${BUDGET_MIDPOINT}) FILTER (WHERE ${base} AND status NOT IN ('closed','dropped')
                                       AND created_at >= date_trunc('month', now()) - interval '1 month'
                                       AND created_at <  date_trunc('month', now())), 0)     AS pipeline_value_last_month
     FROM leads`,
  );

  const stageRows = await query(
    `SELECT status,
            COUNT(*)                                    AS n,
            COALESCE(SUM(${BUDGET_MIDPOINT}), 0)         AS value
       FROM leads
      WHERE ${base}
      GROUP BY status`,
  );
  const stages = ['new', 'contacted', 'site_visit', 'negotiation', 'closed', 'dropped'].map((s) => {
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

export async function logIngest({ source, outcome, reason = null, lead_id = null, http_status = null, payload = null }) {
  try {
    await query(
      `INSERT INTO ingest_log (source, outcome, reason, lead_id, http_status, payload)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [source, outcome, reason, lead_id, http_status, JSON.stringify(payload ?? {})],
    );
  } catch (e) {
    // Logging must never break ingestion.
    console.error('[ingest_log] write failed:', e.message);
  }
}
