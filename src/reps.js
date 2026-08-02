/**
 * Sales reps — replaces the free-text "Acting as" box with a real, shared
 * list everyone on the team sees the same names in. Still not a login
 * system (no passwords, no per-rep auth) — just a controlled vocabulary so
 * the lifecycle audit trail says "Priya" every time, not "priya"/"Priya S"/
 * "priya sales" depending on who typed it.
 */
import { query, one } from './db.js';

export async function listReps({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : '';
  const res = await query(`SELECT * FROM reps ${where} ORDER BY name ASC`);
  return res.rows;
}

export async function createRep(name) {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name is required');
  const existing = await one(`SELECT * FROM reps WHERE LOWER(name) = LOWER($1)`, [clean]);
  if (existing) return existing;
  const res = await query(
    `INSERT INTO reps (name, is_active) VALUES ($1, TRUE) RETURNING *`,
    [clean],
  );
  return res.rows[0];
}

export async function updateRep(id, { name, is_active } = {}) {
  const sets = [];
  const params = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); params.push(String(name).trim()); }
  if (is_active !== undefined) { sets.push(`is_active = $${i++}`); params.push(Boolean(is_active)); }
  if (!sets.length) return one(`SELECT * FROM reps WHERE id = $1`, [id]);
  params.push(id);
  const res = await query(
    `UPDATE reps SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}
