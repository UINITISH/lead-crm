/**
 * One-time fix for leads already inserted by seed-july-leads.js: their
 * lead_events rows (Lifecycle in the drawer) were stamped with today's real
 * date instead of the lead's backdated July date. This restaggers each
 * lead's events starting from its own created_at, a few hours apart, without
 * touching anything else or re-inserting any leads.
 *
 * Run once: node scripts/fix-july-lifecycle-dates.js
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';

await initDb();

const leads = await query(
  `SELECT id, created_at FROM leads WHERE raw_payload->>'batch' = 'july-2026'`,
);

if (!leads.rows.length) {
  console.log('[fix] no leads found from the july-2026 seed batch — nothing to do.');
  await closeDb();
  process.exit(0);
}

let fixed = 0;
for (const lead of leads.rows) {
  const r = await query(
    `UPDATE lead_events SET created_at = $2::timestamptz + (rn - 1) * interval '6 hours'
       FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM lead_events WHERE lead_id = $1) sub
      WHERE lead_events.id = sub.id
      RETURNING lead_events.id`,
    [lead.id, lead.created_at],
  );
  if (r.rowCount) fixed++;
}

console.log(`[fix] restaggered lifecycle events for ${fixed} of ${leads.rows.length} leads`);
await closeDb();
