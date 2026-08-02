/**
 * Deals — distinct from leads. A lead is "someone interested"; a deal is
 * "we're actually negotiating a specific unit with them". A deal only gets
 * created once a lead reaches negotiation (enforced by the caller in
 * routes/admin.js), and carries fields a lead never has: which unit, the
 * agreed price, and an expected close date.
 */
import { query, one } from './db.js';
import { addEvent } from './leads.js';

const STAGES = ['negotiation', 'booked', 'closed_won', 'closed_lost'];
export { STAGES as DEAL_STAGES };

export async function createDeal({ lead_id, unit_number = null, agreed_price = null,
  expected_closing_date = null, notes = null, created_by = null }) {
  const lead = await one(`SELECT developer_name, project_name FROM leads WHERE id = $1`, [lead_id]);
  const res = await query(
    `INSERT INTO deals (lead_id, developer_name, project_name, unit_number, agreed_price, expected_closing_date, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [lead_id, lead?.developer_name ?? null, lead?.project_name ?? null, unit_number, agreed_price, expected_closing_date, notes, created_by],
  );
  const deal = res.rows[0];
  await addEvent(lead_id, {
    event_type: 'note',
    note: `Deal opened${unit_number ? ' for unit ' + unit_number : ''}${agreed_price ? ' at ₹' + agreed_price + 'L' : ''}`,
    actor: created_by || 'admin',
  });
  return deal;
}

export async function listDeals({ stage, limit = 200 } = {}) {
  const where = stage ? `WHERE d.stage = $1` : '';
  const params = stage ? [stage] : [];
  const res = await query(
    `SELECT d.*, l.full_name, l.phone_e164, l.source
       FROM deals d
       JOIN leads l ON l.id = d.lead_id
       ${where}
      ORDER BY d.updated_at DESC
      LIMIT ${Math.min(Number(limit) || 200, 500)}`,
    params,
  );
  return res.rows;
}

export async function listForLead(leadId) {
  const res = await query(
    `SELECT * FROM deals WHERE lead_id = $1 ORDER BY created_at DESC`,
    [leadId],
  );
  return res.rows;
}

export async function getDeal(id) {
  return one(`SELECT d.*, l.full_name, l.phone_e164 FROM deals d JOIN leads l ON l.id = d.lead_id WHERE d.id = $1`, [id]);
}

export async function updateDeal(id, { stage, unit_number, agreed_price, expected_closing_date, notes, actor } = {}) {
  const current = await one(`SELECT * FROM deals WHERE id = $1`, [id]);
  if (!current) return null;

  if (stage && !STAGES.includes(stage)) {
    throw new Error(`stage must be one of ${STAGES.join(', ')}`);
  }

  const res = await query(
    `UPDATE deals SET
        stage = $2, unit_number = $3, agreed_price = $4, expected_closing_date = $5, notes = $6
      WHERE id = $1 RETURNING *`,
    [
      id,
      stage ?? current.stage,
      unit_number !== undefined ? unit_number : current.unit_number,
      agreed_price !== undefined ? agreed_price : current.agreed_price,
      expected_closing_date !== undefined ? expected_closing_date : current.expected_closing_date,
      notes !== undefined ? notes : current.notes,
    ],
  );

  if (stage && stage !== current.stage) {
    await addEvent(current.lead_id, {
      event_type: 'note',
      note: `Deal moved to ${stage.replace('_', ' ')}`,
      actor: actor || 'admin',
    });
  }
  return res.rows[0];
}

/** Summary stats for the Deals page: totals, value, closing soon, win rate. */
export async function dealStats() {
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
     FROM deals`,
  );
  const closedTotal = Number(totals.won) + Number(totals.lost);
  return {
    total_deals: Number(totals.total),
    open_deals: Number(totals.open_deals),
    open_value: Number(totals.open_value),
    closing_this_month: Number(totals.closing_this_month),
    win_rate: closedTotal > 0 ? Math.round((Number(totals.won) / closedTotal) * 1000) / 10 : 0,
  };
}
