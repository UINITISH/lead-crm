/**
 * One-time bulk reassignment of every lead's Status across the 3 values
 * (Pickup / Closed / Not interested), per the target split:
 *
 *   Pickup          ~25%  (the "still open / follow-up / assigned" bucket —
 *                          kept under the requested ~10% floor would leave
 *                          no room for the other two to hit their own
 *                          targets, so the leftover from a 30-40%+40% ask
 *                          that only summed to ~85% was folded in here,
 *                          per instruction: "put the remaining ~15% into
 *                          Pickup")
 *   Not interested  ~35%  (midpoint of the requested 30-40% range)
 *   Closed          ~40%
 *
 * Scope: every lead, across every business — same as the earlier tag/status
 * distribution script, not scoped to a single business.
 *
 * Bucket SIZES are exact (largest-remainder rounding so they sum to the
 * total lead count); which specific leads land in which bucket is random.
 * This only touches leads.status — tags, developer, everything else is
 * untouched.
 *
 * Usage:
 *   node scripts/assign-status-distribution.js           (dry run)
 *   node scripts/assign-status-distribution.js --confirm
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';

const confirm = process.argv.includes('--confirm');

const BUCKETS = [
  { status: 'pickup',         pct: 25 },
  { status: 'not_interested', pct: 35 },
  { status: 'closed',         pct: 40 },
];

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function allocate(total, buckets) {
  const raw = buckets.map((b) => (b.pct / 100) * total);
  const base = raw.map(Math.floor);
  let remaining = total - base.reduce((s, n) => s + n, 0);
  const order = raw
    .map((n, i) => ({ i, frac: n - Math.floor(n) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remaining <= 0) break;
    base[i]++;
    remaining--;
  }
  return base;
}

await initDb();

const { rows: leads } = await query(`SELECT id FROM leads`);
const total = leads.length;
if (!total) {
  console.log('No leads found.');
  await closeDb();
  process.exit(0);
}

const counts = allocate(total, BUCKETS);
console.log(`\n${total} lead(s) total:\n`);
BUCKETS.forEach((b, i) => {
  console.log(`  ${b.status.padEnd(15)} ${counts[i]} lead(s)  (${(100 * counts[i] / total).toFixed(1)}%)`);
});

const shuffled = shuffle(leads);
let cursor = 0;
const assignment = BUCKETS.map((b, i) => {
  const slice = shuffled.slice(cursor, cursor + counts[i]);
  cursor += counts[i];
  return { status: b.status, ids: slice.map((l) => l.id) };
});

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

for (const { status, ids } of assignment) {
  if (!ids.length) continue;
  await query(`UPDATE leads SET status = $1 WHERE id = ANY($2::uuid[])`, [status, ids]);
}

console.log(`\nDone — ${total} lead(s) reassigned.\n`);
await closeDb();
