/**
 * Lead tags — a managed, editable classification (Warm/Cold/Junk/Scheduled/…)
 * that sits alongside the pipeline `status` on a lead, not instead of it.
 * Same shape as reps.js: a small admin-managed list, editable from Settings
 * without touching code. `color` is one of the fixed keys the .tag-* CSS
 * classes in styles.css know about (see COLORS below) — a select dropdown,
 * not a free color picker, so every tag pill actually looks intentional.
 * Scoped per business — each client curates their own tag list.
 */
import { query, one } from './db.js';

export const TAG_COLORS = ['orange', 'blue', 'gray', 'red', 'green', 'purple'];

export async function listTags(businessId, { activeOnly = false } = {}) {
  const where = activeOnly ? 'AND is_active = TRUE' : '';
  const res = await query(`SELECT * FROM lead_tags WHERE business_id = $1 ${where} ORDER BY sort_order ASC, name ASC`, [businessId]);
  return res.rows;
}

export async function createTag(businessId, name, color = 'gray') {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name is required');
  const safeColor = TAG_COLORS.includes(color) ? color : 'gray';
  const existing = await one(`SELECT * FROM lead_tags WHERE business_id = $1 AND LOWER(name) = LOWER($2)`, [businessId, clean]);
  if (existing) return existing;
  const { rows: [{ n }] } = await query(`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM lead_tags WHERE business_id = $1`, [businessId]);
  const res = await query(
    `INSERT INTO lead_tags (business_id, name, color, is_active, sort_order) VALUES ($1, $2, $3, TRUE, $4) RETURNING *`,
    [businessId, clean, safeColor, n],
  );
  return res.rows[0];
}

export async function updateTag(businessId, id, { name, color, is_active } = {}) {
  const sets = [];
  const params = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); params.push(String(name).trim()); }
  if (color !== undefined) { sets.push(`color = $${i++}`); params.push(TAG_COLORS.includes(color) ? color : 'gray'); }
  if (is_active !== undefined) { sets.push(`is_active = $${i++}`); params.push(Boolean(is_active)); }
  if (!sets.length) return one(`SELECT * FROM lead_tags WHERE id = $1 AND business_id = $2`, [id, businessId]);
  params.push(id, businessId);
  const res = await query(
    `UPDATE lead_tags SET ${sets.join(', ')} WHERE id = $${i} AND business_id = $${i + 1} RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}

/**
 * One-time starter list so a new business's dropdown isn't empty on day one —
 * covers exactly the examples asked for (warm/cold/scheduled/junk). Guarded
 * on that business already having any tags, so it's safe to call every time
 * a business is provisioned or migrate() runs, without duplicating rows.
 */
export async function seedDefaultTags(businessId) {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM lead_tags WHERE business_id = $1`, [businessId]);
  if (rows[0].n > 0) return { tags: 0, skipped: true };

  const defaults = [
    ['Warm', 'orange'],
    ['Cold', 'blue'],
    ['Scheduled', 'purple'],
    ['Junk', 'gray'],
  ];
  let count = 0;
  for (const [name, color] of defaults) {
    await createTag(businessId, name, color);
    count++;
  }
  console.log(`[tags] seeded ${count} default lead tags for business ${businessId}`);
  return { tags: count, skipped: false };
}
