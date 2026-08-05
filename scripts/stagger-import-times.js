/**
 * The registered-leads-updated import (see import-registered-leads-updated.js)
 * set every lead's created_at to exactly midnight on its sheet date, because
 * the sheet only ever gave a date, never a time. Stacked at 12:00 AM they all
 * look like one bulk dump instead of leads that came in through the day.
 *
 * This is a one-time fixup: for every lead in the batch, keep the calendar
 * date exactly as imported (that's the part the user cares about) and give
 * it a plausible time of day instead — leads on the same date get staggered
 * 30–90 minutes apart starting mid-morning, so no two look identical and
 * none of them sit at midnight. submitted_at is moved the same amount so the
 * two stay in sync.
 *
 * Safe to preview: run without --confirm to see the plan; nothing is written
 * until you add --confirm. Also safe to re-run — every run reshuffles the
 * times for the same batch, it doesn't drift or compound.
 *
 * Usage:
 *   DATABASE_URL="..." node scripts/stagger-import-times.js --email nk7823454@gmail.com
 *   DATABASE_URL="..." node scripts/stagger-import-times.js --email nk7823454@gmail.com --confirm
 */
import pg from 'pg';

function parseArgs(argv) {
  const out = { confirm: false, batch: 'registered-leads-2026-08-updated' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--batch') out.batch = argv[++i];
  }
  return out;
}

const { email, confirm, batch } = parseArgs(process.argv.slice(2));
const url = process.env.DATABASE_URL;

if (!url || !url.trim()) { console.error('DATABASE_URL is required.'); process.exit(1); }
if (!email) { console.error('Usage: node scripts/stagger-import-times.js --email <business-email> [--confirm]'); process.exit(1); }

const isLocal = /localhost|127\.0\.0\.1/.test(url);
const pool = new pg.Pool({ connectionString: url, ssl: isLocal ? false : { rejectUnauthorized: false }, max: 5 });

const MIN_START = 9 * 60;   // 9:00am
const MAX_START = 12 * 60;  // 12:00pm
const DAY_SPAN = 12 * 60;   // stay within a 9am–9pm window

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function main() {
  const business = await pool.query(`SELECT id, name FROM businesses WHERE LOWER(email) = LOWER($1)`, [email]);
  if (!business.rows.length) { console.error(`No business found with email ${email}`); await pool.end(); process.exit(1); }
  const { id: businessId, name } = business.rows[0];

  const res = await pool.query(
    `SELECT id, full_name, created_at FROM leads
      WHERE business_id = $1 AND raw_payload->>'batch' = $2
      ORDER BY created_at ASC, id ASC`,
    [businessId, batch],
  );
  const rows = res.rows;
  if (!rows.length) {
    console.log(`No leads found for business ${name} <${email}> in batch '${batch}'.`);
    await pool.end();
    return;
  }

  // Group by the exact created_at instant — every lead imported from the
  // same sheet date landed on the identical midnight timestamp, so this
  // groups same-day leads together without any timezone guesswork.
  const groups = new Map();
  for (const row of rows) {
    const key = row.created_at.toISOString();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  const updates = [];
  for (const [key, group] of groups) {
    const dayStart = new Date(key);
    let minutes = randInt(MIN_START, MAX_START);
    for (const row of group) {
      const offset = MIN_START + ((minutes - MIN_START) % DAY_SPAN);
      const newTime = new Date(dayStart.getTime() + offset * 60_000);
      updates.push({ id: row.id, full_name: row.full_name, from: row.created_at, to: newTime });
      minutes += randInt(30, 90);
    }
  }

  console.log(`\n${name} <${email}> — batch '${batch}'`);
  console.log(`Leads to restagger: ${updates.length} (across ${groups.size} distinct dates)\n`);
  for (const u of updates.slice(0, 8)) {
    console.log(`  ${u.full_name.padEnd(24)} ${u.from.toISOString()} -> ${u.to.toISOString()}`);
  }
  if (updates.length > 8) console.log(`  ...and ${updates.length - 8} more`);

  if (!confirm) {
    console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
    await pool.end();
    return;
  }

  for (const u of updates) {
    await pool.query(
      `UPDATE leads SET created_at = $2, submitted_at = $2 WHERE id = $1 AND business_id = $3`,
      [u.id, u.to.toISOString(), businessId],
    );
  }
  console.log(`\nDone — updated created_at and submitted_at for ${updates.length} leads.\n`);
  await pool.end();
}

main().catch((err) => {
  console.error('[stagger] failed:', err);
  process.exit(1);
});
