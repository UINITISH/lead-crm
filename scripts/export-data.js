/**
 * Exports every real (non-catalog) table from the LOCAL PGlite database to a
 * single JSON file, for moving your data to the live server.
 *
 * Deliberately does NOT export developers / projects / project_unit_types /
 * lead_tags — the live server seeds that exact same reference catalog itself
 * on first boot (see migrate.js), and re-importing it would collide with
 * their unique names. Nothing is lost: every lead/deal already carries its
 * developer/project as a plain text snapshot (developer_name/project_name),
 * not a live foreign key, so it still displays correctly either way. If
 * you've added custom developers/projects locally beyond the seeded catalog,
 * they won't carry over automatically — just re-add them once on the live
 * site (typing a new name anywhere creates it, same as locally).
 *
 * Usage:
 *   node scripts/export-data.js [output-file.json]
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';

// Export always reads local dev data, regardless of what .env's DATABASE_URL
// might otherwise say.
process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = process.env.PGLITE_DIR || './.pgdata';

const { query, closeDb } = await import('../src/db.js');

const TABLES = [
  'reps',
  'app_settings',
  'lead_forms',
  'leads',
  'lead_events',
  'deals',
  'deal_applicants',
  'deal_cost_items',
  'deal_payment_milestones',
  'deal_documents',
  'follow_ups',
  'tickets',
  'ticket_events',
  'ingest_log',
];

// leads must come out oldest-first so a duplicate row's duplicate_of always
// points at an id that was already inserted by the time it's imported.
const ORDER_BY = { leads: 'created_at ASC', deals: 'created_at ASC' };

const outPath = process.argv[2] || 'export.json';
const out = {};

console.log('\nExporting local data…\n');
for (const t of TABLES) {
  const orderClause = ORDER_BY[t] ? `ORDER BY ${ORDER_BY[t]}` : '';
  const res = await query(`SELECT * FROM ${t} ${orderClause}`);
  out[t] = res.rows;
  console.log(`  ${t.padEnd(24)} ${res.rows.length} rows`);
}

await writeFile(outPath, JSON.stringify(out));
console.log(`\nWrote ${outPath}\n`);
await closeDb();
