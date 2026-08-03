/**
 * Lead tags — a managed, editable classification (Warm/Cold/Junk/Scheduled/…)
 * that sits alongside the pipeline `status` on a lead, not instead of it.
 * Same shape as reps.js: a small admin-managed list, editable from Settings
 * without touching code. `color` is one of the fixed keys the .tag-* CSS
 * classes in styles.css know about (see COLORS below) — a select dropdown,
 * not a free color picker, so every tag pill actually looks intentional.
 */
import { query, one } from './db.js';

export const TAG_COLORS = ['orange', 'blue', 'gray', 'red', 'green', 'purple'];

export async function listTags({ activeOnly = false } = {}) {
  const where = activeOnly ? 'WHERE is_active = TRUE' : '';
  const res = await query(`SELECT * FROM lead_tags ${where} ORDER BY sort_order ASC, name ASC`);
  return res.rows;
}

export async function createTag(name, color = 'gray') {
  const clean = String(name || '').trim();
  if (!clean) throw new Error('name is required');
  const safeColor = TAG_COLORS.includes(color) ? color : 'gray';
  const existing = await one(`SELECT * FROM lead_tags WHERE LOWER(name) = LOWER($1)`, [clean]);
  if (existing) return existing;
  const { rows: [{ n }] } = await query(`SELECT COALESCE(MAX(sort_order), -1)::int + 1 AS n FROM lead_tags`);
  const res = await query(
    `INSERT INTO lead_tags (name, color, is_active, sort_order) VALUES ($1, $2, TRUE, $3) RETURNING *`,
    [clean, safeColor, n],
  );
  return res.rows[0];
}

export async function updateTag(id, { name, color, is_active } = {}) {
  const sets = [];
  const params = [];
  let i = 1;
  if (name !== undefined) { sets.push(`name = $${i++}`); params.push(String(name).trim()); }
  if (color !== undefined) { sets.push(`color = $${i++}`); params.push(TAG_COLORS.includes(color) ? color : 'gray'); }
  if (is_active !== undefined) { sets.push(`is_active = $${i++}`); params.push(Boolean(is_active)); }
  if (!sets.length) return one(`SELECT * FROM lead_tags WHERE id = $1`, [id]);
  params.push(id);
  const res = await query(
    `UPDATE lead_tags SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    params,
  );
  return res.rows[0] ?? null;
}

/**
 * One-time starter list so the dropdown isn't empty on day one — covers
 * exactly the examples asked for (warm/cold/scheduled/junk). Guarded on an
 * empty table, same pattern as seedDeveloperDirectory: safe to call on every
 * boot, only ever does something the first time.
 */
export async function seedDefaultTags() {
  const { rows } = await query(`SELECT COUNT(*)::int AS n FROM lead_tags`);
  if (rows[0].n > 0) return { tags: 0, skipped: true };

  const defaults = [
    ['Warm', 'orange'],
    ['Cold', 'blue'],
    ['Scheduled', 'purple'],
    ['Junk', 'gray'],
  ];
  let count = 0;
  for (const [name, color] of defaults) {
    await createTag(name, color);
    count++;
  }
  console.log(`[tags] seeded ${count} default lead tags`);
  return { tags: count, skipped: false };
}
