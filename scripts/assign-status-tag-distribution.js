/**
 * One-time bulk reclassification of every lead into 5 buckets, per the
 * split given: Junk 40%, Connected 30%, Site visit 13%, Warm 10%, Cold 10%
 * (these add up to 103%, not 100% — normalized proportionally below so the
 * relative weighting is preserved exactly; e.g. Junk stays 4x the size of
 * Warm, it just lands at ~38.8% instead of a literal 40%).
 *
 * Mapping, as confirmed:
 *   - Junk, Warm, Cold  -> sets leads.tag only (these already exist as tags
 *     for most businesses; created per-business if missing, non-destructive
 *     if they already exist under a different color).
 *   - Connected         -> sets leads.tag = "Connected", a new tag, created
 *     per-business if it doesn't already exist.
 *   - Site visit        -> sets BOTH leads.status = 'site_visit' AND
 *     leads.tag = "Interested/Site Visit" (created if missing).
 * Status is left untouched for every bucket except Site visit — nothing
 * else was asked to change the pipeline stage.
 *
 * Scope: every lead in the leads table, across every business — "All
 * leads" was the explicit choice, not scoped to one business.
 *
 * Bucket ASSIGNMENT is random (which specific leads land in which bucket),
 * but bucket SIZES are computed deterministically via largest-remainder
 * rounding so the overall split matches the normalized percentages exactly
 * — re-running this shows a different sample of which leads got which
 * label, but the same overall bucket sizes.
 *
 * Usage:
 *   node scripts/assign-status-tag-distribution.js           (dry run)
 *   node scripts/assign-status-tag-distribution.js --confirm
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';
import { createTag } from '../src/tags.js';

const confirm = process.argv.includes('--confirm');

const BUCKETS = [
  { label: 'Junk',      pct: 40, tag: 'Junk',                    status: null,        color: 'gray'   },
  { label: 'Connected', pct: 30, tag: 'Connected',                status: null,        color: 'green'  },
  { label: 'Site visit',pct: 13, tag: 'Interested/Site Visit',    status: 'site_visit',color: 'purple' },
  { label: 'Warm',      pct: 10, tag: 'Warm',                     status: null,        color: 'orange' },
  { label: 'Cold',      pct: 10, tag: 'Cold',                     status: null,        color: 'blue'   },
];
const PCT_SUM = BUCKETS.reduce((s, b) => s + b.pct, 0); // 103

/** Fisher-Yates. */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Largest-remainder rounding so bucket sizes sum to exactly `total`. */
function allocate(total, buckets) {
  const raw = buckets.map((b) => (b.pct / PCT_SUM) * total);
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

const { rows: leads } = await query(`SELECT id, business_id FROM leads`);
const total = leads.length;
if (!total) {
  console.log('No leads found.');
  await closeDb();
  process.exit(0);
}

const counts = allocate(total, BUCKETS);
console.log(`\n${total} lead(s) total. Normalized split (raw percentages summed to ${PCT_SUM}%, scaled to 100%):\n`);
BUCKETS.forEach((b, i) => {
  console.log(`  ${b.label.padEnd(11)} ${counts[i]} lead(s)  (${(100 * counts[i] / total).toFixed(1)}%)${b.status ? `  — status: ${b.status}` : ''}  — tag: ${b.tag}`);
});

const shuffled = shuffle(leads);
let cursor = 0;
const assignment = BUCKETS.map((b, i) => {
  const slice = shuffled.slice(cursor, cursor + counts[i]);
  cursor += counts[i];
  return { bucket: b, leads: slice };
});

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

for (const { bucket, leads: bucketLeads } of assignment) {
  if (!bucketLeads.length) continue;
  const businessIds = [...new Set(bucketLeads.map((l) => l.business_id))];
  for (const businessId of businessIds) {
    await createTag(businessId, bucket.tag, bucket.color);
  }
  const ids = bucketLeads.map((l) => l.id);
  if (bucket.status) {
    await query(`UPDATE leads SET tag = $1, status = $2 WHERE id = ANY($3::uuid[])`, [bucket.tag, bucket.status, ids]);
  } else {
    await query(`UPDATE leads SET tag = $1 WHERE id = ANY($2::uuid[])`, [bucket.tag, ids]);
  }
}

console.log(`\nDone — ${total} lead(s) reclassified.\n`);
await closeDb();
