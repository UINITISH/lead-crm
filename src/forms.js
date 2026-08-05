/**
 * Lead-capture forms — the "Contact Form 7" equivalent. An admin creates one
 * of these from the Forms page, gets back a public_id, and embeds
 * /f/:public_id as an <iframe> on the WordPress site. See db/schema.sql for
 * why this needs no shared secret the way /api/leads/website does.
 *
 * `fields` is a freeform, ordered, admin-editable list of {key, label, type,
 * required} — including a 'phone' entry, so an admin can drag it to wherever
 * they want it to appear. It's still special: sanitizeFields() always forces
 * it to be present, type 'tel', and required — because leads.phone_e164 is
 * NOT NULL and dedupe depends on it — an admin can move it but not remove it
 * or make it optional. Older forms saved before this existed get 'phone'
 * backfilled into their stored fields once, by backfillPhoneField() below.
 */
import crypto from 'node:crypto';
import { query, one } from './db.js';
import { cleanText } from './normalize.js';

function genPublicId() {
  return crypto.randomBytes(6).toString('base64url'); // 8 URL-safe chars
}

const FIELD_TYPES = new Set(['text', 'email', 'tel', 'textarea', 'budget', 'project', 'select', 'checkboxes']);
const OPTION_TYPES = new Set(['select', 'checkboxes']);
const CORE_KEYS = new Set(['first_name', 'last_name', 'email', 'phone', 'budget', 'project', 'message']);

export function defaultFields() {
  return [
    { key: 'first_name', label: 'First name', type: 'text', required: true },
    { key: 'last_name', label: 'Last name', type: 'text', required: false },
    { key: 'phone', label: 'Phone', type: 'tel', required: true },
    { key: 'email', label: 'Email', type: 'email', required: false },
    { key: 'budget', label: 'Budget', type: 'budget', required: false },
    { key: 'project', label: 'Which project interested in', type: 'project', required: false },
    { key: 'message', label: 'Message / notes', type: 'textarea', required: false },
  ];
}

let customFieldSeq = 0;

/**
 * Sanitizes an admin-submitted field list — bad/unknown types are dropped,
 * not stored — and guarantees exactly one 'phone' field, always type 'tel'
 * and always required, regardless of what the admin sent (they can drag it
 * anywhere in the list, or omit it entirely and it comes back at the end).
 */
export function sanitizeFields(input) {
  if (!Array.isArray(input)) input = [];
  const seenKeys = new Set();
  const out = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    let key = cleanText(raw.key, 60);
    if (!key || !/^[a-z0-9_]+$/.test(key)) {
      key = CORE_KEYS.has(raw.key) ? raw.key : `custom_${Date.now().toString(36)}_${customFieldSeq++}`;
    }
    if (seenKeys.has(key)) continue;

    if (key === 'phone') {
      seenKeys.add(key);
      out.push({ key: 'phone', label: cleanText(raw.label, 100) || 'Phone', type: 'tel', required: true });
      continue;
    }

    const label = cleanText(raw.label, 100);
    if (!label) continue;
    seenKeys.add(key);
    const type = FIELD_TYPES.has(raw.type) ? raw.type : 'text';

    const field = { key, label, type, required: Boolean(raw.required) };
    if (OPTION_TYPES.has(type)) {
      const options = Array.isArray(raw.options)
        ? raw.options.map((o) => cleanText(o, 150)).filter(Boolean)
        : [];
      field.options = options.length ? options : ['Option 1', 'Option 2'];
    }
    out.push(field);
  }
  if (!seenKeys.has('phone')) out.push({ key: 'phone', label: 'Phone', type: 'tel', required: true });
  return out;
}

/**
 * One-time backfill for forms saved before 'phone' was a real field in the
 * list — injects it right after Last name (or First name, or at the start)
 * so its rendered position doesn't change for anyone. Safe to re-run: a form
 * that already has a 'phone' entry is left untouched.
 */
export async function backfillPhoneField() {
  const { rows } = await query(`SELECT id, fields FROM lead_forms`);
  for (const row of rows) {
    const fields = Array.isArray(row.fields) ? row.fields : [];
    if (fields.some((f) => f && f.key === 'phone')) continue;
    const lastNameIdx = fields.findIndex((f) => f.key === 'last_name');
    const firstNameIdx = fields.findIndex((f) => f.key === 'first_name');
    const insertAt = lastNameIdx !== -1 ? lastNameIdx + 1 : firstNameIdx !== -1 ? firstNameIdx + 1 : 0;
    const next = [...fields];
    next.splice(insertAt, 0, { key: 'phone', label: 'Phone', type: 'tel', required: true });
    await query(`UPDATE lead_forms SET fields = $1 WHERE id = $2`, [JSON.stringify(next), row.id]);
  }
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

export async function createForm({ name, fields, developer_name = null, created_by = null }) {
  let publicId = genPublicId();
  for (let i = 0; i < 5; i++) {
    const clash = await one(`SELECT id FROM lead_forms WHERE public_id = $1`, [publicId]);
    if (!clash) break;
    publicId = genPublicId();
  }
  // Only fall back to the starter set when fields wasn't sent at all — an
  // explicit empty array means the admin deliberately deleted every field
  // and wants a phone-only form, which is a valid choice, not an omission.
  const cleanFields = sanitizeFields(fields !== undefined ? fields : defaultFields());
  const res = await query(
    `INSERT INTO lead_forms (public_id, name, fields, developer_name, created_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [publicId, name, JSON.stringify(cleanFields), developer_name || null, created_by],
  );
  return res.rows[0];
}

export async function updateForm(id, { name, fields, developer_name, is_active } = {}) {
  const sets = [];
  const params = [id];
  if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
  if (fields !== undefined) { params.push(JSON.stringify(sanitizeFields(fields))); sets.push(`fields = $${params.length}`); }
  if (developer_name !== undefined) { params.push(developer_name); sets.push(`developer_name = $${params.length}`); }
  if (is_active !== undefined) { params.push(is_active); sets.push(`is_active = $${params.length}`); }
  if (!sets.length) return getForm(id);
  const res = await query(`UPDATE lead_forms SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
  return res.rows[0] || null;
}

export async function deleteForm(id) {
  const res = await query(`DELETE FROM lead_forms WHERE id = $1 RETURNING id`, [id]);
  return res.rows.length > 0;
}
