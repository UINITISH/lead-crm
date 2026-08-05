/**
 * One-time import of scripts/data/registered-leads-updated.json — 95 leads
 * from "registered leads (updated).xlsx" (added Date, Name, Number, a status
 * column sometimes reading "Booked"/"Booking", Builder name, Booked by).
 *
 * Unlike the earlier registered-leads import, this one is explicit
 * instruction: the sheet's "added Date" must be preserved verbatim as the
 * lead's Added date in the CRM (created_at), NOT the real import time — even
 * though the sheet's years are all over the place (2001 through 2030). That
 * is treated as given data, not an error, and is not corrected here.
 *
 * insertLead()'s COLUMNS list doesn't accept created_at on INSERT (it's a
 * DEFAULT now() column, by design, so live leads always get a truthful
 * timestamp) — so for this backfill-style import we insert through the
 * normal insertLead() path first, then run one UPDATE leads SET created_at
 * per row, scoped to that row's own id + business_id. submitted_at is set to
 * the same sheet date at insert time, since that column *is* settable.
 *
 * Every row still goes through insertLead(), so phone-based dedupe,
 * normalisation, and the lifecycle event log all apply exactly as they would
 * to a live lead. developer_name comes straight from the sheet's "Builder
 * name" column. The 5 rows whose status column contains "book" are marked
 * closed via updateStatus() with a note carrying the "Booked by" value, if
 * present.
 *
 * Tagged with raw_payload->>'batch' = 'registered-leads-2026-08-updated' so
 * it's identifiable/reversible later, and this script refuses to run twice —
 * safe to re-run, it just no-ops if the batch is already present.
 *
 * Usage:
 *   node scripts/import-registered-leads-updated.js
 *   DATABASE_URL="..." node scripts/import-registered-leads-updated.js --email nk7823454@gmail.com
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.js';
import { insertLead, updateStatus } from '../src/leads.js';
import { normalizePhone, cleanText } from '../src/normalize.js';
import { findBusinessByEmail } from '../src/auth.js';
import { query, one, closeDb } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(here, 'data', 'registered-leads-updated.json');
const BATCH_TAG = 'registered-leads-2026-08-updated';
const DEFAULT_EMAIL = 'nk7823454@gmail.com';

const SOURCE_WEIGHTS = { meta: 0.50, google: 0.20, website: 0.30 };

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') out.email = argv[++i];
  }
  return out;
}

function buildShuffledSourceList(n) {
  const counts = {
    meta: Math.round(n * SOURCE_WEIGHTS.meta),
    google: Math.round(n * SOURCE_WEIGHTS.google),
  };
  counts.website = n - counts.meta - counts.google;

  const list = [
    ...Array(counts.meta).fill('meta'),
    ...Array(counts.google).fill('google'),
    ...Array(counts.website).fill('website'),
  ];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { list, counts };
}

/** The sheet's added_date, verbatim — no plausibility correction. Null if unparseable. */
function parseAddedDate(sheetDate) {
  if (!sheetDate) return null;
  const d = new Date(sheetDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function main() {
  await migrate();

  const { email } = parseArgs(process.argv.slice(2));
  const business = await findBusinessByEmail(email || DEFAULT_EMAIL);
  if (!business) {
    console.error(`No business found with email ${email || DEFAULT_EMAIL}`);
    await closeDb();
    process.exit(1);
  }
  const businessId = business.id;

  const already = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1 AND raw_payload->>'batch' = $2`,
    [businessId, BATCH_TAG],
  );
  if (already.rows[0].n > 0) {
    console.log(`[import] batch '${BATCH_TAG}' already imported for this business (${already.rows[0].n} leads found) — skipping.`);
    await closeDb();
    return;
  }

  const raw = await readFile(DATA_PATH, 'utf8');
  const sheetRows = JSON.parse(raw);

  const { list: sources, counts } = buildShuffledSourceList(sheetRows.length);
  console.log(`[import] ${sheetRows.length} rows — source mix: meta=${counts.meta}, google=${counts.google}, website=${counts.website}`);

  let accepted = 0, duplicate = 0, skipped = 0, dated = 0, undated = 0, booked = 0;

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const phone_e164 = normalizePhone(row.phone);
    const full_name = cleanText(row.name, 200);

    if (!phone_e164 || !full_name) {
      skipped++;
      console.log(`[import] skipped (bad name/phone): ${JSON.stringify(row)}`);
      continue;
    }

    const addedDate = parseAddedDate(row.added_date);
    const developer_name = cleanText(row.builder_name, 200);

    const { lead, outcome } = await insertLead(businessId, {
      full_name,
      phone_raw: String(row.phone),
      phone_e164,
      developer_name,
      source: sources[i],
      entry_method: 'manual',
      created_by: 'system',
      is_test: false,
      submitted_at: addedDate,
      raw_payload: { batch: BATCH_TAG, original: row },
    });

    if (outcome === 'duplicate') duplicate++;
    else accepted++;

    if (addedDate) {
      await query(
        `UPDATE leads SET created_at = $3 WHERE id = $1 AND business_id = $2`,
        [lead.id, businessId, addedDate],
      );
      dated++;
    } else {
      undated++;
      console.log(`[import] no parseable added Date for "${full_name}" (${row.phone}) — left at real import time.`);
    }

    if (row.status_or_note && /book/i.test(row.status_or_note)) {
      const note = row.booked_by
        ? `Marked booked on import — Booked by: ${row.booked_by}`
        : 'Marked booked on import';
      await updateStatus(businessId, lead.id, 'closed', { actor: 'system', note });
      booked++;
    }
  }

  console.log(`\n[import] done: ${accepted} accepted, ${duplicate} flagged duplicate (same phone, still stored), ${skipped} skipped.`);
  console.log(`[import] created_at set from sheet: ${dated}, left at import time (no date in sheet): ${undated}.`);
  console.log(`[import] marked closed/booked: ${booked}.`);
  await closeDb();
}

main().catch((err) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
