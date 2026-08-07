/**
 * Bulk-splits a business's existing leads evenly across a set of Team
 * members, round-robin, and writes it to leads.assigned_emails — a one-off
 * catch-up for leads that piled up before the Assigned feature existed (or
 * before that person was added to the Team list), rather than something you
 * run on a routine basis.
 *
 * Only touches leads that are currently UNASSIGNED (assigned_emails is
 * empty) — safe to re-run any time (e.g. after a fresh batch of leads comes
 * in) without reshuffling anyone's existing assignments. Skips duplicates
 * and test leads, same as the Leads page's own "unique leads" count.
 *
 * Every name passed via --names must already be a registered Team member
 * (Settings → Team / scripts/add-reps.js) — this only assigns, it doesn't
 * create reps.
 *
 * Usage:
 *   node scripts/distribute-assignments.js --email corevaluerealtyre@gmail.com --names "Anish,Shoaib,corevaluerealtyre,corevaluerealtysales" --confirm
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { findLoginByEmail } from '../src/auth.js';
import { listReps } from '../src/reps.js';
import { listLeads, updateLead } from '../src/leads.js';
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
  console.error('Usage: node scripts/distribute-assignments.js --email corevaluerealtyre@gmail.com --names "Anish,Shoaib" --confirm');
  process.exit(1);
}

const wantedIds = [...new Set(names.split(',').map((n) => normalizeAssignId(n)).filter(Boolean))];
if (!wantedIds.length) {
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

const reps = await listReps(business.id);
const repByAssignId = new Map(reps.filter((r) => r.email).map((r) => [r.email.toLowerCase(), r]));
const unknown = wantedIds.filter((id) => !repByAssignId.has(id));
if (unknown.length) {
  console.error(`These aren't registered Team members yet (add them with scripts/add-reps.js first): ${unknown.join(', ')}`);
  await closeDb();
  process.exit(1);
}

const allLeads = await listLeads(business.id, {});
const unassigned = allLeads
  .filter((l) => !l.assigned_emails || l.assigned_emails.length === 0)
  .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

console.log(`\nBusiness: "${business.name}"`);
console.log(`Total leads: ${allLeads.length} · already assigned: ${allLeads.length - unassigned.length} · to distribute: ${unassigned.length}`);
console.log(`Splitting round-robin across: ${wantedIds.join(', ')}\n`);

const counts = Object.fromEntries(wantedIds.map((id) => [id, 0]));
for (let i = 0; i < unassigned.length; i++) counts[wantedIds[i % wantedIds.length]]++;
for (const id of wantedIds) console.log(`  ${repByAssignId.get(id).name} (${id}): ${counts[id]} leads`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

for (let i = 0; i < unassigned.length; i++) {
  const id = wantedIds[i % wantedIds.length];
  await updateLead(business.id, unassigned[i].id, { assigned_emails: [id] });
}

console.log(`\nDone. ${unassigned.length} leads assigned.\n`);
await closeDb();
