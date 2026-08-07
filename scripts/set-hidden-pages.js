/**
 * Restricts (or un-restricts) which pages a login can see and reach — both
 * the sidebar nav item and the underlying API routes that exclusively
 * belong to that page (see blockIfHidden in src/routes/admin.js).
 *
 * IMPORTANT: a business can be reached by more than one login — its own
 * primary email, plus any extra ones added via scripts/add-login.js, all of
 * which resolve to the exact same business_id and see the exact same
 * leads/data. This script restricts based on WHICH EMAIL you pass:
 *   - The business's own primary email  -> restriction applies business-wide,
 *     i.e. to every login that shares this business's data.
 *   - An added login's email            -> restriction applies to ONLY that
 *     one login; the business's primary login (and any other added logins)
 *     are completely unaffected.
 * Whichever you target, the OTHER list still applies on top — a login always
 * sees business-wide restrictions plus whatever's set specifically on it.
 *
 * Valid page keys: leads, tickets, forms, ingest, settings, help
 * ('dashboard' isn't hideable — it's the fallback landing page.)
 *
 * Usage:
 *   node scripts/set-hidden-pages.js --email colleague@client.com --hide settings,forms,ingest --confirm
 *   node scripts/set-hidden-pages.js --email colleague@client.com --hide none --confirm   (clears that login's own restrictions)
 *
 * Re-running replaces the full restriction list for whichever login/business
 * you targeted — it doesn't add to what was set before, so always pass the
 * complete set you want hidden for that target.
 */
import 'dotenv/config';
import { initDb, closeDb } from '../src/db.js';
import { findLoginByEmail, setHiddenPages, setLoginHiddenPages } from '../src/auth.js';

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
  console.error('Usage: node scripts/set-hidden-pages.js --email colleague@client.com --hide settings,forms,ingest --confirm');
  console.error(`       (--hide none clears that login's own restrictions; valid keys: ${HIDEABLE_PAGES.join(', ')})`);
  process.exit(1);
}

const pages = hide.toLowerCase() === 'none' ? [] : hide.split(',').map((s) => s.trim()).filter(Boolean);
const bad = pages.filter((p) => !HIDEABLE_PAGES.includes(p));
if (bad.length) {
  console.error(`Unknown page key(s): ${bad.join(', ')}. Valid: ${HIDEABLE_PAGES.join(', ')}`);
  process.exit(1);
}

await initDb();

const found = await findLoginByEmail(email);
if (!found) {
  console.error(`No login found for "${email}"`);
  await closeDb();
  process.exit(1);
}
const { business, loginId } = found;

if (loginId) {
  console.log(`\n"${email}" is an ADDED login on "${business.name}" — this will restrict ONLY this login.`);
  console.log(`The business's own primary login (${business.email}), and any other added logins, are unaffected.`);
} else {
  console.log(`\n"${email}" is the PRIMARY login for "${business.name}" — this restriction applies BUSINESS-WIDE,`);
  console.log(`meaning every login that shares this business's data (including any added via add-login.js) inherits it.`);
}

if (!confirm) {
  console.log(`\nWill hide: ${pages.length ? pages.join(', ') : '(none — full access)'}`);
  console.log(`\nDry run only — nothing written. Re-run with --confirm to apply.\n`);
  await closeDb();
  process.exit(0);
}

if (loginId) {
  await setLoginHiddenPages(loginId, pages);
} else {
  await setHiddenPages(business.id, pages);
}

console.log(`\nDone. Anyone logged into this account will need to log out and back in to see the change immediately`);
console.log(`(API access updates right away either way — the sidebar just needs a fresh login to re-fetch it).\n`);
await closeDb();
