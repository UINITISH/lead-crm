/**
 * Follow-up reminders — "call this lead back on X". A lead capture system
 * with no reminder mechanism just accumulates leads nobody follows up on, so
 * this exists as a real feature, not a UI-only widget: every reminder is a
 * row, tied to a lead, that shows up on the dashboard until it's done.
 * Scoped per business via its own business_id column (set at creation,
 * matching whichever business the lead belongs to).
 */
import { query, one } from './db.js';

export async function createFollowUp(businessId, { lead_id, due_at, note = null, assigned_to = null, created_by = null }) {
  const res = await query(
    `INSERT INTO follow_ups (business_id, lead_id, due_at, note, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [businessId, lead_id, due_at, note, assigned_to, created_by],
  );
  return res.rows[0];
}

/** Upcoming (not done) follow-ups, soonest first, with the lead's contact info attached. */
export async function listUpcoming(businessId, { limit = 20, includeDone = false } = {}) {
  const res = await query(
    `SELECT f.*, l.full_name, l.phone_e164, l.developer_name, l.project_name
       FROM follow_ups f
       JOIN leads l ON l.id = f.lead_id
      WHERE f.business_id = $1 ${includeDone ? '' : 'AND f.is_done = FALSE'}
      ORDER BY f.due_at ASC
      LIMIT ${Math.min(Number(limit) || 20, 200)}`,
    [businessId],
  );
  return res.rows;
}

export async function listForLead(businessId, leadId) {
  const res = await query(
    `SELECT * FROM follow_ups WHERE lead_id = $1 AND business_id = $2 ORDER BY due_at ASC`,
    [leadId, businessId],
  );
  return res.rows;
}

export async function markDone(businessId, id, { done = true } = {}) {
  const res = await query(
    `UPDATE follow_ups SET is_done = $3, done_at = CASE WHEN $3 THEN now() ELSE NULL END
     WHERE id = $1 AND business_id = $2 RETURNING *`,
    [id, businessId, done],
  );
  return res.rows[0] ?? null;
}

export async function updateFollowUp(businessId, id, { due_at, note } = {}) {
  const current = await one(`SELECT * FROM follow_ups WHERE id = $1 AND business_id = $2`, [id, businessId]);
  if (!current) return null;
  const res = await query(
    `UPDATE follow_ups SET due_at = $3, note = $4 WHERE id = $1 AND business_id = $2 RETURNING *`,
    [id, businessId, due_at ?? current.due_at, note !== undefined ? note : current.note],
  );
  return res.rows[0];
}

export async function countUpcoming(businessId) {
  const r = await query(`SELECT COUNT(*)::int AS n FROM follow_ups WHERE business_id = $1 AND is_done = FALSE`, [businessId]);
  return r.rows[0].n;
}
