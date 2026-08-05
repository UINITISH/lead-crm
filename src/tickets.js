/**
 * Support tickets — a discrete, assignable, closeable unit of work. Distinct
 * from `follow_ups` (a simple reminder on one lead) and the lead activity
 * thread (a running log): a ticket has a status lifecycle, a priority, an
 * owner (assignee), and — same audit-trail pattern as leads/deals —
 * every status change or note leaves a permanent trace in ticket_events.
 * Scoped per business via its own business_id column.
 */
import { query, one } from './db.js';

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'];
export const TICKET_DEPARTMENTS = ['general', 'sales', 'payments', 'documentation', 'site_visit'];

/**
 * ticket_events has no business_id of its own — reached through ticket_id,
 * so this confirms ownership first, same reasoning as leads.js's addEvent.
 */
export async function addTicketEvent(businessId, ticketId, { event_type, from_status = null, to_status = null, note = null, actor = 'system' }) {
  const owns = await one(`SELECT id FROM tickets WHERE id = $1 AND business_id = $2`, [ticketId, businessId]);
  if (!owns) return false;
  await query(
    `INSERT INTO ticket_events (ticket_id, event_type, from_status, to_status, note, actor)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [ticketId, event_type, from_status, to_status, note, actor],
  );
  return true;
}

export async function createTicket(businessId, { subject, description = null, department = 'general', priority = 'medium',
  lead_id = null, requester = null, assignee = null, created_by = null }) {
  if (!subject || !subject.trim()) throw new Error('subject is required');
  if (department && !TICKET_DEPARTMENTS.includes(department)) {
    throw new Error(`department must be one of ${TICKET_DEPARTMENTS.join(', ')}`);
  }
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    throw new Error(`priority must be one of ${TICKET_PRIORITIES.join(', ')}`);
  }
  let safeLeadId = null;
  if (lead_id) {
    const lead = await one(`SELECT id FROM leads WHERE id = $1 AND business_id = $2`, [lead_id, businessId]);
    if (!lead) throw new Error('Unknown lead_id');
    safeLeadId = lead.id;
  }
  const res = await query(
    `INSERT INTO tickets (business_id, subject, description, department, priority, lead_id, requester, assignee, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [businessId, subject.trim(), description, department, priority, safeLeadId, requester, assignee, created_by],
  );
  const ticket = res.rows[0];
  await addTicketEvent(businessId, ticket.id, {
    event_type: 'created',
    to_status: 'open',
    note: assignee ? `Ticket raised, assigned to ${assignee}` : 'Ticket raised',
    actor: created_by || 'admin',
  });
  return ticket;
}

export async function listTickets(businessId, filters = {}) {
  const params = [businessId];
  const where = ['t.business_id = $1'];
  const add = (clause, value) => { params.push(value); where.push(clause.replace('?', `$${params.length}`)); };

  if (filters.status)     add('t.status = ?', filters.status);
  if (filters.priority)   add('t.priority = ?', filters.priority);
  if (filters.department) add('t.department = ?', filters.department);
  if (filters.assignee)   add('t.assignee = ?', filters.assignee);
  if (filters.lead_id)    add('t.lead_id = ?', filters.lead_id);
  if (filters.q) {
    params.push(`%${filters.q}%`);
    const p = `$${params.length}`;
    where.push(`(t.subject ILIKE ${p} OR t.description ILIKE ${p} OR t.requester ILIKE ${p})`);
  }

  const res = await query(
    `SELECT t.*, l.full_name AS lead_name, l.phone_e164 AS lead_phone
       FROM tickets t
       LEFT JOIN leads l ON l.id = t.lead_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC
      LIMIT ${Math.min(Number(filters.limit) || 300, 1000)}`,
    params,
  );
  return res.rows;
}

export async function getTicket(businessId, id) {
  const ticket = await one(
    `SELECT t.*, l.full_name AS lead_name, l.phone_e164 AS lead_phone
       FROM tickets t
       LEFT JOIN leads l ON l.id = t.lead_id
      WHERE t.id = $1 AND t.business_id = $2`,
    [id, businessId],
  );
  if (!ticket) return null;
  const events = await query(`SELECT * FROM ticket_events WHERE ticket_id = $1 ORDER BY created_at ASC`, [id]);
  return { ...ticket, events: events.rows };
}

export async function updateTicket(businessId, id, { subject, description, department, priority, status, assignee, requester, note, actor } = {}) {
  const current = await one(`SELECT * FROM tickets WHERE id = $1 AND business_id = $2`, [id, businessId]);
  if (!current) return null;

  if (status && !TICKET_STATUSES.includes(status)) {
    throw new Error(`status must be one of ${TICKET_STATUSES.join(', ')}`);
  }
  if (department && !TICKET_DEPARTMENTS.includes(department)) {
    throw new Error(`department must be one of ${TICKET_DEPARTMENTS.join(', ')}`);
  }
  if (priority && !TICKET_PRIORITIES.includes(priority)) {
    throw new Error(`priority must be one of ${TICKET_PRIORITIES.join(', ')}`);
  }

  const nextStatus = status || current.status;
  const resolvedAt = (nextStatus === 'resolved' || nextStatus === 'closed')
    ? (current.resolved_at || new Date())
    : (nextStatus !== current.status ? null : current.resolved_at);

  const res = await query(
    `UPDATE tickets SET
        subject = $3, description = $4, department = $5, priority = $6,
        status = $7, assignee = $8, requester = $9, resolved_at = $10
      WHERE id = $1 AND business_id = $2 RETURNING *`,
    [
      id, businessId,
      subject !== undefined ? subject : current.subject,
      description !== undefined ? description : current.description,
      department !== undefined ? department : current.department,
      priority !== undefined ? priority : current.priority,
      nextStatus,
      assignee !== undefined ? assignee : current.assignee,
      requester !== undefined ? requester : current.requester,
      resolvedAt,
    ],
  );

  if (status && status !== current.status) {
    await addTicketEvent(businessId, id, { event_type: 'status_change', from_status: current.status, to_status: status, note, actor: actor || 'admin' });
  } else if (note) {
    await addTicketEvent(businessId, id, { event_type: 'note', note, actor: actor || 'admin' });
  } else if (assignee !== undefined && assignee !== current.assignee) {
    await addTicketEvent(businessId, id, { event_type: 'assigned', note: assignee ? `Assigned to ${assignee}` : 'Unassigned', actor: actor || 'admin' });
  }

  return res.rows[0];
}

export async function deleteTicket(businessId, id) {
  const res = await query(`DELETE FROM tickets WHERE id = $1 AND business_id = $2 RETURNING id`, [id, businessId]);
  return res.rows.length > 0;
}

/** KPI counts for the Tickets page header. */
export async function ticketStats(businessId) {
  const row = await one(
    `SELECT
        COUNT(*)                                            AS total,
        COUNT(*) FILTER (WHERE status = 'open')              AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress')        AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved')           AS resolved,
        COUNT(*) FILTER (WHERE status = 'closed')             AS closed,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND status NOT IN ('resolved','closed')) AS urgent_open
     FROM tickets WHERE business_id = $1`,
    [businessId],
  );
  return {
    total: Number(row.total),
    open: Number(row.open),
    in_progress: Number(row.in_progress),
    resolved: Number(row.resolved),
    closed: Number(row.closed),
    urgent_open: Number(row.urgent_open),
  };
}
