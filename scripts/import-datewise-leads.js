/**
 * Imports the two "datewise" sheets the user sent to replace/extend the
 * earlier registered-leads import with real, per-row Date + Time instead of
 * a single date at midnight:
 *
 *  - scripts/data/registered-leads-datewise-95.json
 *      "registered_leads_updated_datewise (1).xlsx" — the SAME 95 leads as
 *      the earlier "registered leads (updated).xlsx" batch (confirmed by
 *      phone-number match, 91/91 unique numbers identical), now carrying a
 *      real Date + Time per row instead of a date-only column. This
 *      supersedes that earlier batch: any leads previously imported under
 *      batch tag 'registered-leads-2026-08-updated' are deleted first (their
 *      events/follow-ups/deals cascade with them — see db/schema.sql), then
 *      re-inserted fresh under a new batch tag with the exact timestamp from
 *      this sheet. Re-deleting-and-reinserting, rather than trying to match
 *      rows to existing leads and patch them in place, sidesteps the two
 *      repeated (name, phone) pairs in this sheet where matching by identity
 *      alone would be ambiguous.
 *
 *  - scripts/data/registered-leads-datewise-575.json
 *      "registered_leads_datewise (1).xlsx" — a separate, non-overlapping
 *      575-lead funnel export (zero phone-number overlap with the 95-lead
 *      sheet, confirmed) that, unlike every previous import, already carries
 *      a real Source per row (Meta Ads / Google Ads / Website) — so there's
 *      no weighted-random source assignment here, the sheet's own value is
 *      used directly.
 *
 * In both sheets, Date is only written on the first row of each day (a
 * forward-fill pattern — blank Date means "same date as the row above"),
 * already resolved into a full date_time ISO string per row when the JSON
 * data files were built.
 *
 * Every date_time is used exactly as given, including verbatim, with no
 * plausibility correction — same instruction as the previous import.
 * created_at is set via a raw UPDATE after insertLead() (which doesn't
 * accept created_at on INSERT — see import-registered-leads-updated.js for
 * why), submitted_at is set at insert time to the same value.
 *
 * Usage:
 *   node scripts/import-datewise-leads.js
 *   DATABASE_URL="..." node scripts/import-datewise-leads.js --email nk7823454@gmail.com
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.js';
import { insertLead, updateStatus } from '../src/leads.js';
import { normalizePhone, cleanText } from '../src/normalize.js';
import { findBusinessByEmail } from '../src/auth.js';
import { query, closeDb } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EMAIL = 'nk7823454@gmail.com';

const OLD_BATCH_A = 'registered-leads-2026-08-updated';       // superseded — midnight-only dates
const BATCH_A = 'registered-leads-2026-08-datewise';           // replacement — real date + time
const BATCH_B = 'registered-leads-2026-08-full-funnel';        // new — 575-row funnel export

const SOURCE_WEIGHTS = { meta: 0.50, google: 0.20, website: 0.30 };

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
  return list;
}

function parseDateTime(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function importSheetA(businessId) {
  const deleted = await query(
    `DELETE FROM leads WHERE business_id = $1 AND raw_payload->>'batch' = $2 RETURNING id`,
    [businessId, OLD_BATCH_A],
  );
  if (deleted.rows.length) {
    console.log(`[datewise] removed ${deleted.rows.length} leads from the superseded '${OLD_BATCH_A}' batch`);
  }

  const already = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1 AND raw_payload->>'batch' = $2`,
    [businessId, BATCH_A],
  );
  if (already.rows[0].n > 0) {
    console.log(`[datewise] batch '${BATCH_A}' already imported (${already.rows[0].n} leads) — skipping.`);
    return;
  }

  const raw = await readFile(path.join(here, 'data', 'registered-leads-datewise-95.json'), 'utf8');
  const rows = JSON.parse(raw);
  const sources = buildShuffledSourceList(rows.length);

  let accepted = 0, duplicate = 0, skipped = 0, undated = 0, booked = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const phone_e164 = normalizePhone(row.phone);
    const full_name = cleanText(row.name, 200);
    if (!phone_e164 || !full_name) {
      skipped++;
      console.log(`[datewise] sheet A skipped (bad name/phone): ${JSON.stringify(row)}`);
      continue;
    }

    const dateTime = parseDateTime(row.date_time);
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
      submitted_at: dateTime,
      raw_payload: { batch: BATCH_A, original: row },
    });
    if (outcome === 'duplicate') duplicate++; else accepted++;

    if (dateTime) {
      await query(`UPDATE leads SET created_at = $2 WHERE id = $1 AND business_id = $3`, [lead.id, dateTime, businessId]);
    } else {
      undated++;
      console.log(`[datewise] sheet A: no parseable date/time for "${full_name}" (${row.phone}) — left at real import time.`);
    }

    if (row.status_or_note && /book/i.test(row.status_or_note)) {
      const note = row.booked_by
        ? `Marked booked on import — Booked by: ${row.booked_by}`
        : 'Marked booked on import';
      await updateStatus(businessId, lead.id, 'closed', { actor: 'system', note });
      booked++;
    }
  }

  console.log(`[datewise] sheet A (${BATCH_A}): ${accepted} accepted, ${duplicate} duplicate, ${skipped} skipped, ${undated} undated, ${booked} booked.`);
}

async function importSheetB(businessId) {
  const already = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE business_id = $1 AND raw_payload->>'batch' = $2`,
    [businessId, BATCH_B],
  );
  if (already.rows[0].n > 0) {
    console.log(`[datewise] batch '${BATCH_B}' already imported (${already.rows[0].n} leads) — skipping.`);
    return;
  }

  const raw = await readFile(path.join(here, 'data', 'registered-leads-datewise-575.json'), 'utf8');
  const rows = JSON.parse(raw);

  let accepted = 0, duplicate = 0, skipped = 0, undated = 0;
  const VALID_SOURCES = new Set(['meta', 'google', 'website']);

  for (const row of rows) {
    const phone_e164 = normalizePhone(row.phone);
    const full_name = cleanText(row.name, 200);
    const source = VALID_SOURCES.has(row.source) ? row.source : null;
    if (!phone_e164 || !full_name || !source) {
      skipped++;
      console.log(`[datewise] sheet B skipped (bad name/phone/source): ${JSON.stringify(row)}`);
      continue;
    }

    const dateTime = parseDateTime(row.date_time);

    const { lead, outcome } = await insertLead(businessId, {
      full_name,
      phone_raw: String(row.phone),
      phone_e164,
      source,
      entry_method: 'manual',
      created_by: 'system',
      is_test: false,
      submitted_at: dateTime,
      raw_payload: { batch: BATCH_B, original: row },
    });
    if (outcome === 'duplicate') duplicate++; else accepted++;

    if (dateTime) {
      await query(`UPDATE leads SET created_at = $2 WHERE id = $1 AND business_id = $3`, [lead.id, dateTime, businessId]);
    } else {
      undated++;
      console.log(`[datewise] sheet B: no parseable date/time for "${full_name}" (${row.phone}) — left at real import time.`);
    }
  }

  console.log(`[datewise] sheet B (${BATCH_B}): ${accepted} accepted, ${duplicate} duplicate, ${skipped} skipped, ${undated} undated.`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--email') out.email = argv[++i];
  }
  return out;
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
  console.log(`[datewise] importing for ${business.name} <${business.email}>`);
  await importSheetA(business.id);
  await importSheetB(business.id);
  await closeDb();
}

main().catch((err) => {
  console.error('[datewise] failed:', err);
  process.exit(1);
});
