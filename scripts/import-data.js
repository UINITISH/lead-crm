/**
 * Imports a JSON file produced by scripts/export-data.js into a target
 * Postgres database (your live server's DATABASE_URL).
 *
 * Safe to run more than once — every insert is ON CONFLICT DO NOTHING, so
 * re-running after a partial failure just fills in whatever's still missing
 * instead of erroring or duplicating rows.
 *
 * Usage:
 *   node scripts/import-data.js export.json "postgres://user:pass@host/db"
 */
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const [, , jsonPath, targetUrl] = process.argv;
if (!jsonPath || !targetUrl) {
  console.error('Usage: node scripts/import-data.js <export.json> <DATABASE_URL>');
  process.exit(1);
}

const data = JSON.parse(await readFile(jsonPath, 'utf8'));

// Same reasoning as src/db.js: managed Postgres (Render etc.) requires SSL on
// external connections, and a bare local URL is the only case that skips it.
const isLocal = /localhost|127\.0\.0\.1/.test(targetUrl);
const pool = new pg.Pool({
  connectionString: targetUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 5,
});

// Parent-before-child order — matters because of foreign keys.
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

// Columns holding JSON that must be re-stringified before going back over
// the wire as an insert parameter (mirrors the JSON_COLUMNS convention in
// leads.js/forms.js).
const JSON_COLUMNS = {
  leads: new Set(['first_touch', 'raw_payload']),
  lead_forms: new Set(['fields']),
  ingest_log: new Set(['payload']),
};

// leads.project_id is a live foreign key into `projects` — a table this
// import deliberately skips (see export-data.js). Null it out rather than
// risk pointing at a project id that doesn't exist on the target database.
// developer_name/project_name (plain text snapshots) still carry the real
// info and are left untouched.
const DROP_COLUMNS = {
  leads: new Set(['project_id']),
};

console.log(`\nImporting into ${targetUrl.replace(/:[^:@]+@/, ':****@')}…\n`);

for (const t of TABLES) {
  const rows = data[t] || [];
  if (!rows.length) { console.log(`  ${t.padEnd(24)} 0 rows`); continue; }

  const jsonCols = JSON_COLUMNS[t] || new Set();
  const dropCols = DROP_COLUMNS[t] || new Set();
  const cols = Object.keys(rows[0]).filter((c) => !dropCols.has(c));
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`;

  let count = 0;
  for (const row of rows) {
    const values = cols.map((c) => (jsonCols.has(c) ? JSON.stringify(row[c] ?? {}) : row[c]));
    await pool.query(sql, values);
    count++;
  }
  console.log(`  ${t.padEnd(24)} ${count} rows`);
}

console.log('\nDone. Restart the live app (or just refresh) to see the data.\n');
await pool.end();
