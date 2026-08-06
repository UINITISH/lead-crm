/**
 * "tru" showed up on some leads' developer/project pill because the
 * spreadsheet imports wrote the builder name straight onto leads.developer_name
 * as free text (see import-datewise-leads.js) — it was never added to the
 * `developers` table, so it never showed up as a checkbox in the Add/Edit
 * lead developer picker either.
 *
 * This does two things:
 *   1. Adds "Truaquapolis" to the developers directory (so it's selectable
 *      going forward, alongside Prestige/Sobha/etc.).
 *   2. Relabels every existing lead whose developer_name contains the bare
 *      token "tru" (comma-separated, case-insensitive, whole-token match —
 *      won't touch something like "Truform" or "Structura") to
 *      "Truaquapolis" instead, so old and new leads read the same way.
 *
 * Usage:
 *   node scripts/add-developer-truaquapolis.js           (dry run)
 *   node scripts/add-developer-truaquapolis.js --confirm
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';
import { findOrCreateDeveloper } from '../src/developers.js';

const confirm = process.argv.includes('--confirm');
const OLD = 'tru';
const NEW = 'Truaquapolis';

await initDb();

const { rows } = await query(
  `SELECT id, business_id, developer_name FROM leads WHERE developer_name ILIKE $1`,
  [`%${OLD}%`],
);

const toFix = rows
  .map((r) => {
    const parts = String(r.developer_name).split(',').map((s) => s.trim());
    if (!parts.some((p) => p.toLowerCase() === OLD)) return null;
    const relabeled = parts.map((p) => (p.toLowerCase() === OLD ? NEW : p)).join(', ');
    return { id: r.id, from: r.developer_name, to: relabeled };
  })
  .filter(Boolean);

console.log(`\nDeveloper directory: will add "${NEW}" (skips silently if it already exists).`);
console.log(`Leads to relabel: ${toFix.length}`);
for (const f of toFix) console.log(`  ${f.id}: "${f.from}" -> "${f.to}"`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

const dev = await findOrCreateDeveloper(NEW, null);
console.log(`\nDeveloper row: "${dev.name}" (id ${dev.id})`);

for (const f of toFix) {
  await query(`UPDATE leads SET developer_name = $1 WHERE id = $2`, [f.to, f.id]);
}

console.log(`Relabeled ${toFix.length} lead(s). Done.\n`);
await closeDb();
