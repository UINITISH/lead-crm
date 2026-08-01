/**
 * Lead repository. All writes go through here so dedupe, idempotency and the
 * audit trail can't be bypassed by a new route someone adds in Phase 2.
 */
import { query, one } from './db.js';

/** Window in which a repeat submission from the same number is a duplicate. */
const DEDUPE_WINDOW_DAYS = Number(process.env.DEDUPE_WINDOW_DAYS || 30);

const COLUMNS = [
  'full_name', 'phone_raw', 'phone_e164', 'email', 'budget_range', 'timeline',
  'project_id', 'source', 'platform_lead_id',
  'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'form_id', 'form_name',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid',
  'landing_page', 'referrer', 'first_touch',
  'is_duplicate', 'duplicate_of', 'is_test',
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
    const prior = await one(
      `SELECT id FROM leads
        WHERE phone_e164 = $1
          AND is_duplicate = FALSE
          AND created_at > now() - ($2 || ' days')::interval
        ORDER BY created_at ASC
        LIMIT 1`,
      [input.phone_e164, String(DEDUPE_WINDOW_DAYS)],
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

  await addEvent(lead.id, {
    event_type: 'created',
    to_status: 'new',
    note: duplicateOf ? `Duplicate of ${duplicateOf}` : `Captured from ${lead.source}`,
    actor: 'system',
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

  if (filters.source)      add('source = ?', filters.source);
  if (filters.status)      add('status = ?', filters.status);
  if (filters.campaign_id) add('campaign_id = ?', filters.campaign_id);
  if (filters.from)        add('created_at >= ?', filters.from);
  if (filters.to)          add('created_at <= ?', filters.to);
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
