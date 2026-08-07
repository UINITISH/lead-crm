/**
 * Restricts (or un-restricts) which pages a client business's login(s) can
 * see and reach — both the sidebar nav item and the underlying API routes
 * that exclusively belong to that page (see blockIfHidden in
 * src/routes/admin.js). Applies to the whole business, so it covers every
 * login that resolves to it (primary email + any scripts/add-login.js extras).
 *
 * Valid page keys: leads, tickets, forms, ingest, settings, help
 * ('dashboard' isn't hideable — it's the fallback landing page.)
 *
 * Usage:
 *   node scripts/set-hidden-pages.js --email owner@client.com --hide settings,forms,ingest --confirm
 *   node scripts/set-hidden-pages.js --email owner@client.com --hide none --confirm   (clears all restrictions)
 *
 * Re-running replaces the full restriction list — it doesn't add to whatever
 * was set before, so always pass the complete set you want hidden.
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { findBusinessByAnyEmail, setHiddenPages } from '../src/auth.js';

const HIDEABLE_PAGES = ['leads', 'tickets', 'forms', 'ingest', 'settings', 'help'];

function parseArgs(argv) {
  const out = { confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--confirm') out.confirm = true;
    else if (a === '--email') out.email = argv[++i];
    else if (a === '--hide') out.hide = argv[++i];
  }
  return out;
}

const { email, hide, confirm } = parseArgs(process.argv.slice(2));
if (!email || hide === undefined) {
  console.error('Usage: node scripts/set-hidden-pages.js --email owner@client.com --hide settings,forms,ingest --confirm');
  console.error(`       (--hide none clears all restrictions; valid keys: ${HIDEABLE_PAGES.join(', ')})`);
  process.exit(1);
}

const pages = hide.toLowerCase() === 'none' ? [] : hide.split(',').map((s) => s.trim()).filter(Boolean);
const bad = pages.filter((p) => !HIDEABLE_PAGES.includes(p));
if (bad.length) {
  console.error(`Unknown page key(s): ${bad.join(', ')}. Valid: ${HIDEABLE_PAGES.join(', ')}`);
  process.exit(1);
}

await initDb();

const business = await findBusinessByAnyEmail(email);
if (!business) {
  console.error(`No business found for login "${email}"`);
  await closeDb();
  process.exit(1);
}

console.log(`\n"${business.name}" (${business.email}):`);
console.log(`  currently hidden: ${business.hidden_pages?.length ? business.hidden_pages.join(', ') : '(none)'}`);
console.log(`  will become:      ${pages.length ? pages.join(', ') : '(none — full access)'}`);

if (!confirm) {
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

await setHiddenPages(business.id, pages);
console.log(`\nDone. Anyone logged into this account will need to log out and back in to see the change immediately`);
console.log(`(API access updates right away either way — the sidebar just needs a fresh login to re-fetch it).\n`);
await closeDb();
