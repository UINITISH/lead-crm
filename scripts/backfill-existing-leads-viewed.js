/**
 * One-time backfill for the new "unread"-style bold row in the Leads table
 * (leads.viewed_at — see db/schema.sql and getLead() in src/leads.js).
 *
 * Without this, every lead that already exists in the database today would
 * show up bold on next deploy, since none of them have ever been "opened"
 * under the new tracking — which isn't the point. The point is: leads that
 * arrive FROM NOW ON are bold until someone opens them. Everything that's
 * already sitting in the CRM today should just be marked as already seen.
 *
 * Run this ONCE, right after deploying the viewed_at migration, before any
 * new leads come in. Safe to re-run (only touches rows still NULL), but
 * there's no reason to run it twice in normal use.
 *
 * Usage:
 *   node scripts/backfill-existing-leads-viewed.js           (dry run)
 *   node scripts/backfill-existing-leads-viewed.js --confirm
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';

const confirm = process.argv.includes('--confirm');

await initDb();

const { rows } = await query(`SELECT COUNT(*)::int AS n FROM leads WHERE viewed_at IS NULL`);
const n = rows[0].n;
console.log(`\n${n} lead(s) currently unviewed — will be marked as already-seen (viewed_at = created_at).`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

await query(`UPDATE leads SET viewed_at = created_at WHERE viewed_at IS NULL`);
console.log(`\nDone — ${n} lead(s) backfilled.\n`);
await closeDb();
