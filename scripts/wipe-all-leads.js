/**
 * Deletes every lead for a business — not just is_test leads (that's
 * wipeTestLeads() in src/settings.js, used by the Settings page's "Clear
 * test leads" button). This is the blunt "start over" tool: every lead,
 * its activity thread, follow-ups, and any deal/booking opened from it
 * (lead_events/follow_ups/deals all CASCADE off leads.id — see db/schema.sql).
 * Tickets linked to a deleted lead keep existing; only their lead_id link
 * is cleared (ON DELETE SET NULL), same for ingest_log.
 *
 * Requires an explicit --confirm flag so this can never run by accident.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/wipe-all-leads.js --email nk7823454@gmail.com --confirm
 */
import pg from 'pg';

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--email') out.email = argv[++i];
  }
  return out;
}

const { email, confirm } = parseArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;

if (!url || !url.trim()) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}
if (!email) {
  console.error('Usage: node scripts/wipe-all-leads.js --email <business-email> --confirm');
  process.exit(1);
}
if (!confirm) {
  console.error('Refusing to run without --confirm. This permanently deletes leads.');
  process.exit(1);
}

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

const business = await pool.query(`SELECT id, name FROM businesses WHERE LOWER(email) = LOWER($1)`, [email]);
if (!business.rows.length) {
  console.error(`No business found with email ${email}`);
  await pool.end();
  process.exit(1);
}
const { id: businessId, name } = business.rows[0];

const before = await pool.query(`SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1`, [businessId]);
console.log(`\n${name} <${email}> — business_id ${businessId}`);
console.log(`Leads to delete: ${before.rows[0].n}\n`);

const res = await pool.query(`DELETE FROM leads WHERE business_id = $1 RETURNING id`, [businessId]);
console.log(`Deleted ${res.rows.length} leads (and their events, follow-ups, and deals via cascade).`);

const after = await pool.query(`SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1`, [businessId]);
console.log(`Leads remaining: ${after.rows[0].n}\n`);

await pool.end();
