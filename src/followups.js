/**
 * Follow-up reminders — "call this lead back on X". A lead capture system
 * with no reminder mechanism just accumulates leads nobody follows up on, so
 * this exists as a real feature, not a UI-only widget: every reminder is a
 * row, tied to a lead, that shows up on the dashboard until it's done.
 */
import { query, one } from './db.js';

export async function createFollowUp({ lead_id, due_at, note = null, assigned_to = null, created_by = null }) {
  const res = await query(
    `INSERT INTO follow_ups (lead_id, due_at, note, assigned_to, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [lead_id, due_at, note, assigned_to, created_by],
  );
  return res.rows[0];
}

/** Upcoming (not done) follow-ups, soonest first, with the lead's contact info attached. */
export async function listUpcoming({ limit = 20, includeDone = false } = {}) {
  const res = await query(
    `SELECT f.*, l.full_name, l.phone_e164, l.developer_name, l.project_name
       FROM follow_ups f
       JOIN leads l ON l.id = f.lead_id
      ${includeDone ? '' : 'WHERE f.is_done = FALSE'}
      ORDER BY f.due_at ASC
      LIMIT ${Math.min(Number(limit) || 20, 200)}`,
  );
  return res.rows;
}

export async function listForLead(leadId) {
  const res = await query(
    `SELECT * FROM follow_ups WHERE lead_id = $1 ORDER BY due_at ASC`,
    [leadId],
  );
  return res.rows;
}

export async function markDone(id, { done = true } = {}) {
  const res = await query(
    `UPDATE follow_ups SET is_done = $2, done_at = CASE WHEN $2 THEN now() ELSE NULL END
     WHERE id = $1 RETURNING *`,
    [id, done],
  );
  return res.rows[0] ?? null;
}

export async function updateFollowUp(id, { due_at, note } = {}) {
  const current = await one(`SELECT * FROM follow_ups WHERE id = $1`, [id]);
  if (!current) return null;
  const res = await query(
    `UPDATE follow_ups SET due_at = $2, note = $3 WHERE id = $1 RETURNING *`,
    [id, due_at ?? current.due_at, note !== undefined ? note : current.note],
  );
  return res.rows[0];
}

export async function countUpcoming() {
  const r = await query(`SELECT COUNT(*)::int AS n FROM follow_ups WHERE is_done = FALSE`);
  return r.rows[0].n;
}
