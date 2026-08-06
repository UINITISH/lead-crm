/**
 * Folds one business's LOGIN into another business's DATA. Concretely: the
 * "from" business's email keeps working as a login (same password, unchanged
 * — the exact hash is copied over, nobody has to reset anything), but from
 * that point on it resolves to the "into" business's leads/deals/settings
 * instead of its own. The "from" business row itself is deleted once
 * nothing references it any more.
 *
 * Built for exactly the situation of scripts/create-business.js having
 * created a second, separate, empty tenant when what was actually wanted was
 * a second login into the FIRST tenant's existing data — this undoes that
 * split without losing the password already set on the second login, and
 * without touching a single lead/deal already in the first tenant.
 *
 * Any real data on "from" (leads, deals, follow-ups, ingest log, forms,
 * tickets) is reassigned to "into" rather than discarded, on the off chance
 * something was created there before the merge — for the common case (a
 * business created seconds ago, never used) these are all zero-row updates.
 * Its seeded scaffolding (default tags, default settings, reps) is dropped
 * rather than reassigned, since "into" already has its own copy of exactly
 * that scaffolding and merging the two would just collide on uniqueness
 * constraints for no benefit.
 *
 * Usage:
 *   node scripts/merge-business-login.js --from second@biz.com --into owner@biz.com --confirm
 */
import 'dotenv/config';
import { migrate } from '../src/migrate.js';
import { findBusinessByEmail } from '../src/auth.js';
import { query, closeDb } from '../src/db.js';

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--from') out.from = argv[++i];
    else if (a === '--into') out.into = argv[++i];
  }
  return out;
}

const { from: fromEmail, into: intoEmail, confirm } = parseArgs(process.argv.slice(2));
if (!fromEmail || !intoEmail) {
  console.error('Usage: node scripts/merge-business-login.js --from second@biz.com --into owner@biz.com --confirm');
  process.exit(1);
}

const REASSIGN_TABLES = ['leads', 'deals', 'follow_ups', 'ingest_log', 'lead_forms', 'tickets'];
const DROP_TABLES = ['lead_tags', 'app_settings', 'reps'];

await migrate();

const from = await findBusinessByEmail(fromEmail);
const into = await findBusinessByEmail(intoEmail);
if (!from) { console.error(`No business found with email ${fromEmail}`); await closeDb(); process.exit(1); }
if (!into) { console.error(`No business found with email ${intoEmail}`); await closeDb(); process.exit(1); }
if (from.id === into.id) { console.error(`${fromEmail} and ${intoEmail} are already the same business.`); await closeDb(); process.exit(1); }

console.log(`\nFrom: ${from.name} <${from.email}> — business_id ${from.id}`);
console.log(`Into: ${into.name} <${into.email}> — business_id ${into.id}\n`);

for (const table of REASSIGN_TABLES) {
  const res = await query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE business_id = $1`, [from.id]);
  console.log(`  ${table}: ${res.rows[0].n} row(s) on "from" — will be reassigned to "into"`);
}

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

for (const table of REASSIGN_TABLES) {
  await query(`UPDATE ${table} SET business_id = $1 WHERE business_id = $2`, [into.id, from.id]);
}
for (const table of DROP_TABLES) {
  await query(`DELETE FROM ${table} WHERE business_id = $1`, [from.id]);
}

// Preserve the exact password hash already set on "from" — the person keeps
// using the same password, they're just now logging into "into"'s data.
await query(
  `INSERT INTO business_logins (business_id, email, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (LOWER(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, business_id = EXCLUDED.business_id`,
  [into.id, from.email, from.password_hash],
);

await query(`DELETE FROM businesses WHERE id = $1`, [from.id]);

console.log(`\nDone. ${from.email} now logs in with its existing password and lands in "${into.name}"'s data.`);
console.log(`Its vanity URL (if it had a slug) is no longer claimed by anyone — the login still works from`);
console.log(`the app's root URL or "${into.name}"'s own vanity link.\n`);

await closeDb();
