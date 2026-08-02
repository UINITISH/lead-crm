/**
 * Removes the ~250 demo leads created by scripts/seed-july-leads.js —
 * identified by the exact tag that script stamped on every row it inserted
 * (raw_payload->>'batch' = 'july-2026'). Nothing else is touched: real leads,
 * manually-entered leads, and anything from the actual webhooks are untagged
 * and won't match.
 *
 * lead_events, deals, and follow_ups all have ON DELETE CASCADE back to
 * leads, so removing the lead rows cleans up their history/deals/follow-ups
 * automatically — no orphaned rows left behind.
 *
 * Prints what it's about to delete BEFORE deleting it. If the count looks
 * wrong, stop (Ctrl+C) before it does anything.
 *
 * Usage:  node scripts/delete-july-seed-leads.js
 */
import { query, closeDb } from '../src/db.js';

const BATCH_TAG = 'july-2026';

async function main() {
  const preview = await query(
    `SELECT id, full_name, phone_e164, created_at
       FROM leads
      WHERE raw_payload->>'batch' = $1
      ORDER BY created_at
      LIMIT 5`,
    [BATCH_TAG],
  );
  const { rows: [{ n }] } = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE raw_payload->>'batch' = $1`,
    [BATCH_TAG],
  );

  console.log(`[delete-july-seed-leads] found ${n} lead(s) tagged batch='${BATCH_TAG}'`);
  if (n === 0) {
    console.log('[delete-july-seed-leads] nothing to do.');
    await closeDb();
    return;
  }

  console.log('[delete-july-seed-leads] first few:');
  for (const r of preview.rows) {
    console.log(`  ${r.full_name || '(no name)'} · ${r.phone_e164 || ''} · ${r.created_at}`);
  }

  const res = await query(
    `DELETE FROM leads WHERE raw_payload->>'batch' = $1 RETURNING id`,
    [BATCH_TAG],
  );
  // res.rowCount isn't populated consistently between pg and PGlite for a
  // DELETE ... RETURNING — res.rows.length is, on both.
  console.log(`[delete-july-seed-leads] deleted ${res.rows.length} lead(s), plus their lifecycle events/deals/follow-ups.`);

  await closeDb();
}

main().catch((err) => {
  console.error('[delete-july-seed-leads] failed:', err);
  process.exit(1);
});
