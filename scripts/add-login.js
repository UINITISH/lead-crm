/**
 * Adds another login (email + password) that resolves to an EXISTING
 * business's data — unlike scripts/create-business.js, this does NOT create
 * a new isolated tenant. Whoever signs in with this new email sees the exact
 * same leads/deals/settings as the business's original login.
 *
 * Safe to re-run with the same --email: updates that login's password
 * instead of erroring.
 *
 * Usage:
 *   node scripts/add-login.js --for owner@business.com --email colleague@business.com --password "a-strong-password"
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { findBusinessByEmail, addLoginToBusiness } from '../src/auth.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { out[a.slice(2)] = argv[i + 1]; i++; }
  }
  return out;
}

const { for: forEmail, email, password } = parseArgs(process.argv.slice(2));

if (!forEmail || !email || !password) {
  console.error('Usage: node scripts/add-login.js --for owner@business.com --email colleague@business.com --password "a-strong-password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

await initDb();

const business = await findBusinessByEmail(forEmail);
if (!business) {
  console.error(`No business found with email ${forEmail}`);
  await closeDb();
  process.exit(1);
}

const login = await addLoginToBusiness({ businessId: business.id, email, password });

console.log(`\nAdded login for "${business.name}":`);
console.log(`  business: ${business.name} <${business.email}>`);
console.log(`  new login: ${login.email}`);
console.log(`\nThey can now sign in with ${login.email} and the password you just set, and will see`);
console.log(`the exact same data as ${business.email} — at the app's root URL or either business's vanity link.\n`);

await closeDb();
