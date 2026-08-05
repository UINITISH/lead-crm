/**
 * Provisions (or updates) a client business's login. This is deliberately a
 * local CLI, not an HTTP route — see the module comment in src/auth.js for
 * why. Run it against whichever DATABASE_URL you want to affect (your local
 * .env for local testing, or the live Render DATABASE_URL to set up a real
 * client).
 *
 * Usage:
 *   node scripts/create-business.js --name "Acme Realty" --email owner@acme.com --password "s3cret-pw"
 *
 * Re-running with the same --email updates that business's name/password
 * instead of creating a duplicate (upsertBusiness matches on email).
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { upsertBusiness } from '../src/auth.js';
import { seedDefaultTags } from '../src/tags.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const { name, email, password } = parseArgs(process.argv.slice(2));

if (!name || !email || !password) {
  console.error('Usage: node scripts/create-business.js --name "Business Name" --email you@example.com --password "a-strong-password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

await initDb();

const { business, created } = await upsertBusiness({ name, email, password });
await seedDefaultTags(business.id);

console.log(created ? '\nCreated new business:' : '\nUpdated existing business:');
console.log(`  id:    ${business.id}`);
console.log(`  name:  ${business.name}`);
console.log(`  email: ${business.email}`);
console.log(`  slug:  ${business.slug}`);
console.log(`\nThey can log in with this email and the password you just set, either at your`);
console.log(`app's root URL, or at their own vanity link: https://www.findmigo.com/${business.slug}\n`);

await closeDb();
