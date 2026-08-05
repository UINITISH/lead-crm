/**
 * Sales reps — replaces the free-text "Acting as" box with a real, shared
 * list everyone on the team sees the same names in. Still not a login
 * system (no passwords, no per-rep auth) — just a controlled vocabulary so
 * the lifecycle audit trail says "Priya" every time, not "priya"/"Priya S"/
 * "priya sales" depending on who typed it. Scoped per business, same as
 * everything else.
 */
import { query, one } from './db.js';

export async function listReps(businessId, { activeOnly = false } = {}) {
  const where = activeOnly ? 'AND is_active = TRUE' : '';
  const res = await query(`SELECT * FROM reps WHERE business_id = $1 ${where} ORDER BY name ASC`, [businessId]);
  return res.rows;
}

export async function createRep(businessId, name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name is required');
  const existing = await one(`SELECT * FROM reps WHERE business_id = $1 AND LOWER(name) = LOWER($2)`, [businessId, clean]);
  if (existing) return existing;
  const res = await query(
    `INSERT INTO reps (business_id, name, is_active) VALUES ($1, $2, TRUE) RETURNING *`,
    [businessId, clean],
  );
  return res.rows[0];
}

export async function updateRep(businessId, id, { name, is_active } = {}) {
  const sets = [];
  const params = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); params.push(String(name).trim()); }
  if (is_active !== undefined) { sets.push(`is_active = $${i++}`); params.push(Boolean(is_active)); }
  if (!sets.length) return one(`SELECT * FROM reps WHERE id = $1 AND business_id = $2`, [id, businessId]);
  params.push(id, businessId);
  const res = await query(
    `UPDATE reps SET ${sets.join(', ')} WHERE id = $${i} AND business_id = $${i + 1} RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}
