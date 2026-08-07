/**
 * Adds (or updates) one or more Team members on a business in one shot, each
 * with an email set so they immediately become assignable in the Leads
 * "Assigned" column/filter — only reps with reps.email show up there (see
 * client/src/components/AssignedMultiSelect.jsx).
 *
 * These names don't map to real domain email addresses, so the given string
 * is used as BOTH the rep's name and its email value. That's fine — reps.email
 * doesn't have to look like a real address, it's just the identifier stored
 * on leads.assigned_emails and matched against (see resolveAssignedEmails in
 * src/routes/admin.js).
 *
 * Usage:
 *   node scripts/add-reps.js --email corevaluerealtyre@gmail.com --names "Anish,Shoaib,corevaluerealtyre,corevaluerealtysales" --confirm
 *
 * Safe to re-run — an existing rep (matched by name, case-insensitive) just
 * gets its email set/updated rather than being duplicated.
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { findLoginByEmail } from '../src/auth.js';
import { createRep, updateRep, listReps } from '../src/reps.js';
import { normalizeAssignId } from '../src/normalize.js';

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--names') out.names = argv[++i];
  }
  return out;
}

const { email, names, confirm } = parseArgs(process.argv.slice(2));
if (!email || !names) {
  console.error('Usage: node scripts/add-reps.js --email corevaluerealtyre@gmail.com --names "Anish,Shoaib" --confirm');
  process.exit(1);
}

const list = names.split(',').map((s) => s.trim()).filter(Boolean);
if (!list.length) {
  console.error('No names given.');
  process.exit(1);
}

await initDb();

const found = await findLoginByEmail(email);
if (!found) {
  console.error(`No login found for "${email}"`);
  await closeDb();
  process.exit(1);
}
const { business } = found;

console.log(`\nBusiness: "${business.name}"`);
console.log(`Will add/update these Team members, each with its own name used as its assignment id:`);
for (const n of list) console.log(`  - ${n}  (assignment id: ${normalizeAssignId(n)})`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

const existingReps = await listReps(business.id);
for (const n of list) {
  const assignId = normalizeAssignId(n);
  const existing = existingReps.find((r) => r.name.toLowerCase() === n.toLowerCase());
  if (existing) {
    await updateRep(business.id, existing.id, { email: assignId });
    console.log(`Updated existing rep "${n}" — assignment id set to "${assignId}"`);
  } else {
    await createRep(business.id, n, assignId);
    console.log(`Created rep "${n}" — assignment id "${assignId}"`);
  }
}

console.log(`\nDone. They'll show up in Settings → Team and be assignable on Leads right away.\n`);
await closeDb();
