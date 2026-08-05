/**
 * Deals — distinct from leads. A lead is "someone interested"; a deal is
 * "we're actually negotiating a specific unit with them". A deal only gets
 * created once a lead reaches negotiation (enforced by the caller in
 * routes/admin.js), and carries fields a lead never has: which unit, the
 * agreed price, and an expected close date.
 *
 * Multi-tenant: `deals` has its own business_id column, checked directly.
 * The four booking sub-resource tables (deal_applicants, deal_cost_items,
 * deal_payment_milestones, deal_documents) do NOT have their own
 * business_id — they're reached through deal_id, so every by-id operation
 * on them (update/delete) joins through `deals` to confirm it belongs to
 * `businessId` before touching anything. Skipping that join is exactly the
 * kind of bug that would let one client edit another client's booking.
 */
import { query, one } from './db.js';
import { addEvent } from './leads.js';

const STAGES = ['negotiation', 'booked', 'closed_won', 'closed_lost'];
export { STAGES as DEAL_STAGES };

export async function createDeal(businessId, { lead_id, unit_number = null, agreed_price = null,
  expected_closing_date = null, notes = null, created_by = null }) {
  const lead = await one(`SELECT developer_name, project_name FROM leads WHERE id = $1 AND business_id = $2`, [lead_id, businessId]);
  if (!lead) return null;
  const res = await query(
    `INSERT INTO deals (business_id, lead_id, developer_name, project_name, unit_number, agreed_price, expected_closing_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [businessId, lead_id, lead.developer_name ?? null, lead.project_name ?? null, unit_number, agreed_price, expected_closing_date, notes, created_by],
  );
  const deal = res.rows[0];
  await addEvent(businessId, lead_id, {
    event_type: 'note',
    note: `Deal opened${unit_number ? ' for unit ' + unit_number : ''}${agreed_price ? ' at ₹' + agreed_price + 'L' : ''}`,
    actor: created_by || 'admin',
  });
  return deal;
}

export async function listDeals(businessId, { stage, limit = 200 } = {}) {
  const params = [businessId];
  const where = ['d.business_id = $1'];
  if (stage) { params.push(stage); where.push(`d.stage = $${params.length}`); }
  const res = await query(
    `SELECT d.*, l.full_name, l.phone_e164, l.source
       FROM deals d
       JOIN leads l ON l.id = d.lead_id
      WHERE ${where.join(' AND ')}
      ORDER BY d.updated_at DESC
      LIMIT ${Math.min(Number(limit) || 200, 500)}`,
    params,
  );
  return res.rows;
}

export async function listForLead(businessId, leadId) {
  const res = await query(
    `SELECT * FROM deals WHERE lead_id = $1 AND business_id = $2 ORDER BY created_at DESC`,
    [leadId, businessId],
  );
  return res.rows;
}

export async function getDeal(businessId, id) {
  return one(
    `SELECT d.*, l.full_name, l.phone_e164 FROM deals d JOIN leads l ON l.id = d.lead_id WHERE d.id = $1 AND d.business_id = $2`,
    [id, businessId],
  );
}

export async function updateDeal(businessId, id, { stage, unit_number, agreed_price, expected_closing_date, notes, actor } = {}) {
  const current = await one(`SELECT * FROM deals WHERE id = $1 AND business_id = $2`, [id, businessId]);
  if (!current) return null;

  if (stage && !STAGES.includes(stage)) {
    throw new Error(`stage must be one of ${STAGES.join(', ')}`);
  }

  const res = await query(
    `UPDATE deals SET
        stage = $3, unit_number = $4, agreed_price = $5, expected_closing_date = $6, notes = $7
      WHERE id = $1 AND business_id = $2 RETURNING *`,
    [
      id, businessId,
      stage ?? current.stage,
      unit_number !== undefined ? unit_number : current.unit_number,
      agreed_price !== undefined ? agreed_price : current.agreed_price,
      expected_closing_date !== undefined ? expected_closing_date : current.expected_closing_date,
      notes !== undefined ? notes : current.notes,
    ],
  );

  if (stage && stage !== current.stage) {
    await addEvent(businessId, current.lead_id, {
      event_type: 'note',
      note: `Deal moved to ${stage.replace('_', ' ')}`,
      actor: actor || 'admin',
    });
  }
  return res.rows[0];
}

// ---------------------------------------------------------------------------
// Bookings & payment tracking — the paperwork a real booking generates once a
// deal is underway: who's on the application, what the total cost breaks
// down to, the payment schedule against it, and a document checklist. Each
// sub-resource is its own small table (deal_applicants/deal_cost_items/
// deal_payment_milestones/deal_documents), all scoped to one deal_id — and
// via that deal_id, to `businessId`.
// ---------------------------------------------------------------------------

/** Confirms `dealId` belongs to `businessId` — used before every sub-resource write. */
async function ownsDeal(businessId, dealId) {
  const row = await one(`SELECT id FROM deals WHERE id = $1 AND business_id = $2`, [dealId, businessId]);
  return Boolean(row);
}

export async function listApplicants(businessId, dealId) {
  if (!(await ownsDeal(businessId, dealId))) return [];
  const res = await query(
    `SELECT * FROM deal_applicants WHERE deal_id = $1 ORDER BY sort_order, created_at`, [dealId],
  );
  return res.rows;
}

export async function addApplicant(businessId, dealId, { full_name, relation = 'primary', phone = null, email = null,
  pan = null, aadhaar = null, address = null, notes = null, sort_order = 0 }) {
  if (!(await ownsDeal(businessId, dealId))) return null;
  if (!full_name || !full_name.trim()) throw new Error('full_name is required');
  if (!['primary', 'co_applicant'].includes(relation)) throw new Error('relation must be primary or co_applicant');
  const res = await query(
    `INSERT INTO deal_applicants (deal_id, full_name, relation, phone, email, pan, aadhaar, address, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [dealId, full_name.trim(), relation, phone, email, pan, aadhaar, address, notes, sort_order],
  );
  return res.rows[0];
}

export async function updateApplicant(businessId, id, fields = {}) {
  const current = await one(
    `SELECT a.* FROM deal_applicants a JOIN deals d ON d.id = a.deal_id WHERE a.id = $1 AND d.business_id = $2`,
    [id, businessId],
  );
  if (!current) return null;
  if (fields.relation && !['primary', 'co_applicant'].includes(fields.relation)) {
    throw new Error('relation must be primary or co_applicant');
  }
  const res = await query(
    `UPDATE deal_applicants SET
        full_name = $2, relation = $3, phone = $4, email = $5, pan = $6, aadhaar = $7, address = $8, notes = $9
      WHERE id = $1 RETURNING *`,
    [
      id,
      fields.full_name !== undefined ? fields.full_name : current.full_name,
      fields.relation !== undefined ? fields.relation : current.relation,
      fields.phone !== undefined ? fields.phone : current.phone,
      fields.email !== undefined ? fields.email : current.email,
      fields.pan !== undefined ? fields.pan : current.pan,
      fields.aadhaar !== undefined ? fields.aadhaar : current.aadhaar,
      fields.address !== undefined ? fields.address : current.address,
      fields.notes !== undefined ? fields.notes : current.notes,
    ],
  );
  return res.rows[0];
}

export async function deleteApplicant(businessId, id) {
  const res = await query(
    `DELETE FROM deal_applicants a USING deals d
      WHERE a.id = $1 AND d.id = a.deal_id AND d.business_id = $2 RETURNING a.id`,
    [id, businessId],
  );
  return res.rows.length > 0;
}

export async function listCostItems(businessId, dealId) {
  if (!(await ownsDeal(businessId, dealId))) return [];
  const res = await query(
    `SELECT * FROM deal_cost_items WHERE deal_id = $1 ORDER BY sort_order, created_at`, [dealId],
  );
  return res.rows;
}

export async function addCostItem(businessId, dealId, { label, amount = 0, sort_order = 0 }) {
  if (!(await ownsDeal(businessId, dealId))) return null;
  if (!label || !label.trim()) throw new Error('label is required');
  const res = await query(
    `INSERT INTO deal_cost_items (deal_id, label, amount, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
    [dealId, label.trim(), Number(amount) || 0, sort_order],
  );
  return res.rows[0];
}

export async function updateCostItem(businessId, id, fields = {}) {
  const current = await one(
    `SELECT c.* FROM deal_cost_items c JOIN deals d ON d.id = c.deal_id WHERE c.id = $1 AND d.business_id = $2`,
    [id, businessId],
  );
  if (!current) return null;
  const res = await query(
    `UPDATE deal_cost_items SET label = $2, amount = $3 WHERE id = $1 RETURNING *`,
    [
      id,
      fields.label !== undefined ? fields.label : current.label,
      fields.amount !== undefined ? (Number(fields.amount) || 0) : current.amount,
    ],
  );
  return res.rows[0];
}

export async function deleteCostItem(businessId, id) {
  const res = await query(
    `DELETE FROM deal_cost_items c USING deals d
      WHERE c.id = $1 AND d.id = c.deal_id AND d.business_id = $2 RETURNING c.id`,
    [id, businessId],
  );
  return res.rows.length > 0;
}

export async function listMilestones(businessId, dealId) {
  if (!(await ownsDeal(businessId, dealId))) return [];
  const res = await query(
    `SELECT * FROM deal_payment_milestones WHERE deal_id = $1 ORDER BY sort_order, due_date NULLS LAST, created_at`,
    [dealId],
  );
  return res.rows;
}

export async function addMilestone(businessId, dealId, { label, due_date = null, amount = 0, notes = null, sort_order = 0 }) {
  if (!(await ownsDeal(businessId, dealId))) return null;
  if (!label || !label.trim()) throw new Error('label is required');
  const res = await query(
    `INSERT INTO deal_payment_milestones (deal_id, label, due_date, amount, notes, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [dealId, label.trim(), due_date, Number(amount) || 0, notes, sort_order],
  );
  return res.rows[0];
}

/**
 * Updating a milestone can mark it paid — when that happens, default
 * paid_date to today and paid_amount to the full scheduled amount unless the
 * caller specified otherwise, and drop a note in the lead's activity thread
 * (via the deal's lead_id) since "payment received" is the one booking event
 * genuinely worth surfacing there.
 */
export async function updateMilestone(businessId, id, fields = {}, { actor = 'admin' } = {}) {
  const current = await one(
    `SELECT m.*, d.lead_id AS deal_lead_id FROM deal_payment_milestones m
       JOIN deals d ON d.id = m.deal_id WHERE m.id = $1 AND d.business_id = $2`,
    [id, businessId],
  );
  if (!current) return null;
  if (fields.status && !['pending', 'paid', 'overdue'].includes(fields.status)) {
    throw new Error('status must be one of pending, paid, overdue');
  }

  const nextAmount = fields.amount !== undefined ? (Number(fields.amount) || 0) : Number(current.amount);
  let nextStatus = fields.status !== undefined ? fields.status : current.status;
  let nextPaidAmount = fields.paid_amount !== undefined ? (Number(fields.paid_amount) || 0) : Number(current.paid_amount);
  let nextPaidDate = fields.paid_date !== undefined ? fields.paid_date : current.paid_date;

  const becamePaid = nextStatus === 'paid' && current.status !== 'paid';
  if (becamePaid) {
    if (fields.paid_amount === undefined) nextPaidAmount = nextAmount;
    if (fields.paid_date === undefined) nextPaidDate = new Date().toISOString().slice(0, 10);
  }

  const res = await query(
    `UPDATE deal_payment_milestones SET
        label = $2, due_date = $3, amount = $4, paid_amount = $5, paid_date = $6, status = $7, notes = $8
      WHERE id = $1 RETURNING *`,
    [
      id,
      fields.label !== undefined ? fields.label : current.label,
      fields.due_date !== undefined ? fields.due_date : current.due_date,
      nextAmount,
      nextPaidAmount,
      nextPaidDate,
      nextStatus,
      fields.notes !== undefined ? fields.notes : current.notes,
    ],
  );

  if (becamePaid && current.deal_lead_id) {
    await addEvent(businessId, current.deal_lead_id, {
      event_type: 'note',
      note: `Payment received — ${current.label}: ₹${nextPaidAmount}L`,
      actor,
    });
  }
  return res.rows[0];
}

export async function deleteMilestone(businessId, id) {
  const res = await query(
    `DELETE FROM deal_payment_milestones m USING deals d
      WHERE m.id = $1 AND d.id = m.deal_id AND d.business_id = $2 RETURNING m.id`,
    [id, businessId],
  );
  return res.rows.length > 0;
}

export async function listDocuments(businessId, dealId) {
  if (!(await ownsDeal(businessId, dealId))) return [];
  const res = await query(
    `SELECT * FROM deal_documents WHERE deal_id = $1 ORDER BY sort_order, created_at`, [dealId],
  );
  return res.rows;
}

export async function addDocument(businessId, dealId, { name, status = 'pending', reference = null, sort_order = 0 }) {
  if (!(await ownsDeal(businessId, dealId))) return null;
  if (!name || !name.trim()) throw new Error('name is required');
  if (status && !['pending', 'received', 'verified'].includes(status)) {
    throw new Error('status must be one of pending, received, verified');
  }
  const res = await query(
    `INSERT INTO deal_documents (deal_id, name, status, reference, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [dealId, name.trim(), status, reference, sort_order],
  );
  return res.rows[0];
}

export async function updateDocument(businessId, id, fields = {}) {
  const current = await one(
    `SELECT doc.* FROM deal_documents doc JOIN deals d ON d.id = doc.deal_id WHERE doc.id = $1 AND d.business_id = $2`,
    [id, businessId],
  );
  if (!current) return null;
  if (fields.status && !['pending', 'received', 'verified'].includes(fields.status)) {
    throw new Error('status must be one of pending, received, verified');
  }
  const res = await query(
    `UPDATE deal_documents SET name = $2, status = $3, reference = $4 WHERE id = $1 RETURNING *`,
    [
      id,
      fields.name !== undefined ? fields.name : current.name,
      fields.status !== undefined ? fields.status : current.status,
      fields.reference !== undefined ? fields.reference : current.reference,
    ],
  );
  return res.rows[0];
}

export async function deleteDocument(businessId, id) {
  const res = await query(
    `DELETE FROM deal_documents doc USING deals d
      WHERE doc.id = $1 AND d.id = doc.deal_id AND d.business_id = $2 RETURNING doc.id`,
    [id, businessId],
  );
  return res.rows.length > 0;
}

/**
 * Everything the Bookings panel needs in one round trip, plus the rollup
 * numbers (total cost from the cost sheet, total paid/due from the payment
 * schedule) that turn a list of line items into an actual answer to "how
 * much is left to collect on this booking". Returns null if the deal isn't
 * this business's.
 */
export async function getBooking(businessId, dealId) {
  if (!(await ownsDeal(businessId, dealId))) return null;
  const [applicants, cost_items, milestones, documents] = await Promise.all([
    listApplicants(businessId, dealId), listCostItems(businessId, dealId),
    listMilestones(businessId, dealId), listDocuments(businessId, dealId),
  ]);
  const total_cost = cost_items.reduce((sum, c) => sum + Number(c.amount), 0);
  const total_paid = milestones.reduce((sum, m) => sum + Number(m.paid_amount), 0);
  const total_scheduled = milestones.reduce((sum, m) => sum + Number(m.amount), 0);
  return {
    applicants, cost_items, milestones, documents,
    totals: {
      total_cost,
      total_scheduled,
      total_paid,
      total_due: Math.max(total_cost - total_paid, 0),
    },
  };
}

/** Summary stats for the Deals page: totals, value, closing soon, win rate. */
export async function dealStats(businessId) {
  const totals = await one(
    `SELECT
        COUNT(*)                                                                    AS total,
        COUNT(*) FILTER (WHERE stage IN ('negotiation','booked'))                    AS open_deals,
        COALESCE(SUM(agreed_price) FILTER (WHERE stage IN ('negotiation','booked')), 0) AS open_value,
        COUNT(*) FILTER (WHERE stage = 'closed_won')                                 AS won,
        COUNT(*) FILTER (WHERE stage = 'closed_lost')                                AS lost,
        COUNT(*) FILTER (WHERE expected_closing_date IS NOT NULL
                            AND expected_closing_date >= date_trunc('month', now())
                            AND expected_closing_date <  date_trunc('month', now()) + interval '1 month'
                            AND stage IN ('negotiation','booked'))                    AS closing_this_month
     FROM deals WHERE business_id = $1`,
    [businessId],
  );
  const closedTotal = Number(totals.won) + Number(totals.lost);

  // Business-wide booking collection numbers — how much the cost sheets
  // across every deal add up to vs. how much has actually been paid against
  // the payment schedules. Scoped through a join to deals, since the two
  // detail tables have no business_id of their own.
  const payments = await one(
    `SELECT
        (SELECT COALESCE(SUM(c.amount), 0) FROM deal_cost_items c JOIN deals d ON d.id = c.deal_id WHERE d.business_id = $1) AS total_cost,
        (SELECT COALESCE(SUM(m.paid_amount), 0) FROM deal_payment_milestones m JOIN deals d ON d.id = m.deal_id WHERE d.business_id = $1) AS total_paid`,
    [businessId],
  );
  const total_cost = Number(payments.total_cost);
  const total_paid = Number(payments.total_paid);

  return {
    total_deals: Number(totals.total),
    open_deals: Number(totals.open_deals),
    open_value: Number(totals.open_value),
    closing_this_month: Number(totals.closing_this_month),
    win_rate: closedTotal > 0 ? Math.round((Number(totals.won) / closedTotal) * 1000) / 10 : 0,
    total_booking_cost: total_cost,
    total_collected: total_paid,
    total_due: Math.max(total_cost - total_paid, 0),
  };
}
