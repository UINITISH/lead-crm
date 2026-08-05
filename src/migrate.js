/**
 * Applies db/schema.sql. Idempotent — safe to re-run.
 * Usage: npm run migrate
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { initDb, exec, query, closeDb } from './db.js';
import { seedDeveloperDirectory } from './developers.js';
import { seedDefaultTags } from './tags.js';
import { backfillPhoneField } from './forms.js';
import { getDefaultBusinessId, backfillBusinessSlugs } from './auth.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Every table that carries a business_id column — must match db/schema.sql.
const TENANT_TABLES = [
  'leads', 'deals', 'follow_ups', 'app_settings', 'reps',
  'ingest_log', 'lead_tags', 'lead_forms', 'tickets',
];

/**
 * One-time (idempotent) step: creates the first business if none exists yet,
 * then backfills business_id on every row that predates multi-tenancy —
 * without this, every business-scoped query in the app would return zero
 * rows against pre-existing data. Also finally switches app_settings' primary
 * key from bare `key` to composite (business_id, key), which can only happen
 * once every row actually has a business_id (see schema.sql's comment there).
 *
 * The default business's email defaults to the app owner's own address so
 * that running `node scripts/create-business.js --email <same address>`
 * afterwards updates this exact row (upsertBusiness matches on email)
 * instead of creating an orphaned second business.
 */
async function ensureDefaultBusinessAndBackfill() {
  let businessId = await getDefaultBusinessId();

  if (!businessId) {
    const name = process.env.DEFAULT_BUSINESS_NAME || 'Core Value Realty';
    const email = process.env.DEFAULT_BUSINESS_EMAIL || 'nk7823454@gmail.com';
    const res = await query(
      `INSERT INTO businesses (name, email) VALUES ($1, $2) RETURNING id`,
      [name, email],
    );
    businessId = res.rows[0].id;
    console.log(`[migrate] created default business "${name}" <${email}> (id ${businessId})`);
    console.log(`[migrate] set its login password with: node scripts/create-business.js --name "${name}" --email ${email} --password <choose-one>`);
  }

  for (const table of TENANT_TABLES) {
    await query(`UPDATE ${table} SET business_id = $1 WHERE business_id IS NULL`, [businessId]);
  }

  // Safe to re-run: DROP CONSTRAINT IF EXISTS + re-add is a no-op once this
  // has already happened, and every row above is now guaranteed non-null.
  await exec(`
    ALTER TABLE app_settings ALTER COLUMN business_id SET NOT NULL;
    ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey;
    ALTER TABLE app_settings ADD CONSTRAINT app_settings_pkey PRIMARY KEY (business_id, key);
  `);

  return businessId;
}

export async function migrate() {
  await initDb();
  const sql = await readFile(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
  await exec(sql);
  console.log('[migrate] schema applied');
  // Reference data, not demo data — unlike scripts/seed.js this always runs
  // so the manual lead entry form has a developer/project list out of the box.
  await seedDeveloperDirectory();
  const businessId = await ensureDefaultBusinessAndBackfill();
  await seedDefaultTags(businessId);
  await backfillPhoneField();
  await backfillBusinessSlugs();
}

// pathToFileURL, not string concatenation — a space in the path (e.g. anything
// under "Application Support") makes the naive comparison silently false.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => closeDb())
    .catch((e) => {
      console.error('[migrate] failed:', e);
      process.exit(1);
    });
}
