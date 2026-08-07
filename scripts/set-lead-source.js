/**
 * Corrects a single lead's Source — a one-off data fix, not a bulk tool.
 * (The Edit lead panel's Source field was intentionally made read-only in
 * the UI; this is the escape hatch for genuine corrections.)
 *
 * Matches by full name (case-insensitive). If more than one lead shares
 * that name, nothing is changed — re-run with --phone to disambiguate.
 *
 * Usage:
 *   node scripts/set-lead-source.js --name "Sangeeth Sharma" --source website
 *   node scripts/set-lead-source.js --name "Sangeeth Sharma" --source website --confirm
 *   node scripts/set-lead-source.js --name "Sangeeth Sharma" --phone +919769161772 --source website --confirm
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';
import { updateLead } from '../src/leads.js';

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--phone') out.phone = argv[++i];
    else if (a === '--source') out.source = argv[++i];
  }
  return out;
}

const { name, phone, source, confirm } = parseArgs(process.argv.slice(2));
const VALID_SOURCES = ['meta', 'google', 'website'];
if (!name || !source) {
  console.error('Usage: node scripts/set-lead-source.js --name "Sangeeth Sharma" --source website [--phone +91...] --confirm');
  process.exit(1);
}
if (!VALID_SOURCES.includes(source)) {
  console.error(`--source must be one of: ${VALID_SOURCES.join(', ')}`);
  process.exit(1);
}

await initDb();

const params = [name];
let where = `LOWER(full_name) = LOWER($1)`;
if (phone) { params.push(phone); where += ` AND phone_e164 = $2`; }

const { rows } = await query(
  `SELECT id, business_id, full_name, phone_e164, source FROM leads WHERE ${where} ORDER BY created_at`,
  params,
);

if (!rows.length) {
  console.log(`\nNo lead found matching name "${name}"${phone ? ` and phone ${phone}` : ''}.\n`);
  await closeDb();
  process.exit(1);
}
if (rows.length > 1) {
  console.log(`\n${rows.length} leads match "${name}" — be more specific with --phone:\n`);
  for (const r of rows) console.log(`  ${r.full_name}  ${r.phone_e164}  source=${r.source}  (id ${r.id})`);
  console.log('');
  await closeDb();
  process.exit(1);
}

const lead = rows[0];
console.log(`\n${lead.full_name} (${lead.phone_e164}): source ${lead.source} -> ${source}`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

await updateLead(lead.business_id, lead.id, { source });
console.log(`Done.\n`);
await closeDb();
