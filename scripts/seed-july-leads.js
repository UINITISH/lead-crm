/**
 * Adds ~250 realistic leads spread randomly across July 2026 (1st–31st),
 * pulled against the already-seeded developer/project directory.
 *
 * One-off data-population script, not part of the regular seed/test flow —
 * run by hand: `node scripts/seed-july-leads.js`
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { insertLead, addEvent } from '../src/leads.js';

// Clean up leads created during earlier feature-verification/testing, so
// they don't sit mixed in with the real July dataset.
const TEST_LEAD_NAMES = [
  'Test Manual Lead', 'New Builder Lead', 'Budget Test Lead',
  'Dash Lead 1', 'Dash Lead 2', 'Dash Lead 3', 'New Stage Lead',
];

await initDb();
await migrate();

const removed = await query(
  `DELETE FROM leads WHERE full_name = ANY($1) RETURNING id`,
  [TEST_LEAD_NAMES],
);
if (removed.rowCount) console.log(`[cleanup] removed ${removed.rowCount} test lead(s) from earlier verification`);

const devRows = await query(
  `SELECT d.id, d.name, d.grade, p.id AS project_id, p.name AS project_name
     FROM developers d
     LEFT JOIN projects p ON p.developer_id = d.id`,
);
if (!devRows.rows.length) {
  console.error('[seed-july] No developers found — run `npm run migrate` first.');
  await closeDb();
  process.exit(1);
}
const byDeveloper = {};
for (const r of devRows.rows) {
  byDeveloper[r.id] = byDeveloper[r.id] || { name: r.name, grade: r.grade, projects: [] };
  if (r.project_id) byDeveloper[r.id].projects.push({ id: r.project_id, name: r.project_name });
}
const developers = Object.values(byDeveloper);

const FIRST_NAMES = [
  'Rajesh','Amit','Priya','Vikram','Neha','Arjun','Shreya','Anil','Divya','Rohan',
  'Ananya','Karthik','Isha','Suresh','Pooja','Nikhil','Sneha','Ajay','Deepak','Sanya',
  'Manoj','Richa','Harshit','Riya','Sundeep','Anjali','Varun','Nisha','Sanjay','Megha',
  'Rahul','Sakshi','Abhinav','Kritika','Vivek','Tanvi','Ashok','Gauri','Naveen','Swati',
  'Akshay','Uday','Heena','Siddharth','Priyanka','Manish','Aisha','Harsh','Ramesh','Kavya',
];
const LAST_NAMES = [
  'Sharma','Patel','Kumar','Singh','Gupta','Reddy','Rao','Nair','Menon','Verma',
  'Desai','Jain','Iyer','Pillai','Saxena','Malhotra','Chopra','Arora','Bhat','Khanna',
  'Sinha','Tripathi','Pandey','Mishra','Yadav','Tiwari','Shukla','Bansal','Bose','Kulkarni',
];
const TIMELINES = ['immediate', 'within 3 months', 'within 6 months', 'within 12 months', null];
const SOURCES = [
  { s:'meta', w:45, campaigns:['Lead gen | Jul','Retargeting | Site visitors','Lookalike 1%'] },
  { s:'google', w:35, campaigns:['Search | Brand','Search | Exact match','Performance Max'] },
  { s:'website', w:20, campaigns:[null] },
];
const STATUS_WEIGHTS = [
  { s:'new', w:35 }, { s:'contacted', w:25 }, { s:'site_visit', w:18 },
  { s:'negotiation', w:12 }, { s:'closed', w:6 }, { s:'dropped', w:4 },
];
const REPS = ['Priya', 'Arjun', 'Rohit', 'Sneha', 'Vikram'];

function pickWeighted(items) {
  const total = items.reduce((a, i) => a + i.w, 0);
  let r = Math.random() * total;
  for (const i of items) { if ((r -= i.w) <= 0) return i; }
  return items[items.length - 1];
}
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

/** Distribute `total` across `days` slots with real variety — including zeros. */
function distributeDays(total, days) {
  const buckets = [0, 0, 1, 2, 2, 3, 4, 5, 5, 6, 7, 8, 10, 10, 12, 15, 18];
  const counts = Array.from({ length: days }, () => pick(buckets));
  let sum = counts.reduce((a, b) => a + b, 0);
  while (sum !== total) {
    const idx = randInt(0, days - 1);
    if (sum < total) { counts[idx]++; sum++; }
    else if (counts[idx] > 0) { counts[idx]--; sum--; }
  }
  return counts;
}

const TOTAL = 250;
const dailyCounts = distributeDays(TOTAL, 31);

console.log('[seed-july] daily distribution (July 1–31, 2026):');
console.log(dailyCounts.map((n, i) => `Jul ${i + 1}: ${n}`).join('  ').replace(/(.{1,120})(?:\s|$)/g, '$1\n'));
console.log(`[seed-july] total: ${dailyCounts.reduce((a, b) => a + b, 0)}`);

let phoneCounter = 700000000;
let accepted = 0, dupes = 0;

for (let day = 0; day < 31; day++) {
  const count = dailyCounts[day];
  const dateStr = `2026-07-${String(day + 1).padStart(2, '0')}`;

  for (let i = 0; i < count; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const dev = pick(developers);
    const hasProject = dev.projects.length > 0 && Math.random() < 0.7;
    const project = hasProject ? pick(dev.projects) : null;

    const gradeFactor = dev.grade === 'A' ? [80, 250, 20, 150] : dev.grade === 'B' ? [30, 120, 10, 80] : [40, 150, 15, 100];
    const budget_min = randInt(gradeFactor[0], gradeFactor[1]);
    const budget_max = budget_min + randInt(gradeFactor[2], gradeFactor[3]);

    const sourceInfo = pickWeighted(SOURCES);
    const statusInfo = pickWeighted(STATUS_WEIGHTS);
    const isManual = Math.random() < 0.35;
    const actor = isManual ? pick(REPS) : null;
    const campaign = pick(sourceInfo.campaigns);

    const hour = randInt(9, 20);
    const minute = randInt(0, 59);
    const timestamp = new Date(`${dateStr}T${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}:00+05:30`).toISOString();

    phoneCounter++;
    const phone10 = String(phoneCounter).padStart(9, '0');
    const phoneDigits = '9' + phone10;

    const payload = {
      full_name: `${firstName} ${lastName}`,
      phone_raw: phoneDigits,
      phone_e164: '+91' + phoneDigits.slice(-10),
      email: Math.random() < 0.6 ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}${randInt(1,999)}@gmail.com` : null,
      budget_range: `${budget_min}-${budget_max}L`,
      budget_min, budget_max,
      timeline: pick(TIMELINES),
      developer_name: dev.name,
      project_name: project ? project.name : null,
      project_id: project ? project.id : null,
      source: sourceInfo.s,
      campaign_name: campaign,
      utm_source: sourceInfo.s === 'website' ? null : sourceInfo.s,
      utm_campaign: campaign,
      entry_method: isManual ? 'manual' : 'automatic',
      created_by: actor,
      is_test: false,
      submitted_at: timestamp,
      raw_payload: { seeded: true, batch: 'july-2026' },
    };

    const { lead, outcome } = await insertLead(payload);
    await query(`UPDATE leads SET created_at = $2, updated_at = $2 WHERE id = $1`, [lead.id, timestamp]);

    if (outcome === 'duplicate') { dupes++; continue; }
    accepted++;

    // Walk the status forward through history so lead_events (and the
    // dashboard's activity feed / pipeline) has a believable trail, not a
    // lead that teleports straight to "closed".
    const order = ['new', 'contacted', 'site_visit', 'negotiation', 'closed'];
    const target = statusInfo.s === 'dropped' ? 'dropped' : statusInfo.s;
    const targetIdx = order.indexOf(target);
    if (targetIdx > 0) {
      let cur = 'new';
      for (let step = 1; step <= targetIdx; step++) {
        const next = order[step];
        await query(`UPDATE leads SET status = $2 WHERE id = $1`, [lead.id, next]);
        await addEvent(lead.id, {
          event_type: 'status_change', from_status: cur, to_status: next,
          actor: actor || 'system',
        });
        cur = next;
      }
    } else if (target === 'dropped') {
      await query(`UPDATE leads SET status = 'dropped' WHERE id = $1`, [lead.id]);
      await addEvent(lead.id, { event_type:'status_change', from_status:'new', to_status:'dropped', actor: actor || 'system' });
    }

    // addEvent() always stamps created_at = now() — every lifecycle entry
    // would otherwise show today's real date instead of the backdated July
    // date the lead itself carries. Restagger each event a few hours apart,
    // starting from the lead's own (already backdated) timestamp.
    await query(
      `UPDATE lead_events SET created_at = $2::timestamptz + (rn - 1) * interval '6 hours'
         FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM lead_events WHERE lead_id = $1) sub
        WHERE lead_events.id = sub.id`,
      [lead.id, timestamp],
    );
  }
}

console.log(`[seed-july] ${accepted} leads inserted, ${dupes} flagged as duplicates`);
await closeDb();
