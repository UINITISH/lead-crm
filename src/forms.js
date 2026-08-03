/**
 * Lead-capture forms — the "Contact Form 7" equivalent. An admin creates one
 * of these from the Forms page, gets back a public_id, and embeds
 * /f/:public_id as an <iframe> on the WordPress site. See db/schema.sql for
 * why this needs no shared secret the way /api/leads/website does.
 */
import crypto from 'node:crypto';
import { query, one } from './db.js';

function genPublicId() {
  return crypto.randomBytes(6).toString('base64url'); // 8 URL-safe chars
}

/** All forms, each annotated with how many real (non-duplicate) leads it has produced. */
export async function listForms() {
  const res = await query(
    `SELECT f.*,
            COUNT(l.id) FILTER (WHERE l.is_duplicate = FALSE)::int AS submission_count
       FROM lead_forms f
       LEFT JOIN leads l ON l.form_id = f.public_id AND l.source = 'website'
      GROUP BY f.id
      ORDER BY f.created_at DESC`,
  );
  return res.rows;
}

export async function getForm(id) {
  return one(`SELECT * FROM lead_forms WHERE id = $1`, [id]);
}

/** Only returns active forms — an inactive form's public page shows a "no longer accepting" message instead. */
export async function getFormByPublicId(publicId) {
  return one(`SELECT * FROM lead_forms WHERE public_id = $1`, [publicId]);
}

export async function createForm({
  name, show_email = true, show_budget = true, show_project = true, show_message = true,
  developer_name = null, created_by = null,
}) {
  let publicId = genPublicId();
  for (let i = 0; i < 5; i++) {
    const clash = await one(`SELECT id FROM lead_forms WHERE public_id = $1`, [publicId]);
    if (!clash) break;
    publicId = genPublicId();
  }
  const res = await query(
    `INSERT INTO lead_forms (public_id, name, show_email, show_budget, show_project, show_message, developer_name, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [publicId, name, Boolean(show_email), Boolean(show_budget), Boolean(show_project), Boolean(show_message), developer_name || null, created_by],
  );
  return res.rows[0];
}

const EDITABLE_FORM_FIELDS = ['name', 'show_email', 'show_budget', 'show_project', 'show_message', 'developer_name', 'is_active'];

export async function updateForm(id, fields = {}) {
  const keys = EDITABLE_FORM_FIELDS.filter((k) => fields[k] !== undefined);
  if (!keys.length) return getForm(id);
  const sets = keys.map((k, i) => `${k} = $${i + 2}`);
  const params = [id, ...keys.map((k) => fields[k])];
  const res = await query(`UPDATE lead_forms SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return res.rows[0] || null;
}

export async function deleteForm(id) {
  const res = await query(`DELETE FROM lead_forms WHERE id = $1 RETURNING id`, [id]);
  return res.rows.length > 0;
}
