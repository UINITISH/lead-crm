/**
 * One-time import of scripts/data/registered-leads.json — 95 real leads from
 * "registered leads (1).xlsx" (Name, Phone, a Date, and sometimes a
 * Builder-name / booking-status note). The sheet had no ad-platform info, so
 * per instruction each row is tagged with a source (meta / google / website)
 * assigned by weighted random shuffle — NOT sequential blocks — targeting:
 *   meta ~50%, google ~20%, website ~30%
 * (within the requested 30-65% meta / 20% google / remainder website).
 *
 * Every row goes through the same insertLead() the rest of the app uses, so
 * phone-based dedupe, normalisation, and the lifecycle event log all apply
 * exactly as they would to a live lead. Historical sheet dates are unreliable
 * (years jump from 2001 to 2028) so `created_at` is left as real import time;
 * the sheet's original date is kept on the record as `submitted_at` (when it
 * parses) and in raw_payload.original for full traceability either way.
 *
 * Tagged with raw_payload->>'batch' = 'registered-leads-2026-08' so it's
 * identifiable/reversible later (same pattern as delete-july-seed-leads.js),
 * and this script refuses to run twice — safe to re-run, it just no-ops.
 *
 * Usage:  node scripts/import-registered-leads.js
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/migrate.js';
import { insertLead } from '../src/leads.js';
import { normalizePhone, cleanText } from '../src/normalize.js';
import { query, closeDb } from '../src/db.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(here, 'data', 'registered-leads.json');
const BATCH_TAG = 'registered-leads-2026-08';

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
  // Fisher-Yates shuffle — "mix and match", not blocks of one source in a row.
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return { list, counts };
}

/** A sheet date that parses cleanly to ISO, or null. Doesn't fight bad data. */
function parseSubmittedAt(sheetDate) {
  if (!sheetDate) return null;
  const d = new Date(sheetDate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function main() {
  await migrate();

  const already = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE raw_payload->>'batch' = $1`,
    [BATCH_TAG],
  );
  if (already.rows[0].n > 0) {
    console.log(`[import] batch '${BATCH_TAG}' already imported (${already.rows[0].n} leads found) — skipping.`);
    await closeDb();
    return;
  }

  const raw = await readFile(DATA_PATH, 'utf8');
  const sheetRows = JSON.parse(raw);

  const { list: sources, counts } = buildShuffledSourceList(sheetRows.length);
  console.log(`[import] ${sheetRows.length} rows — source mix: meta=${counts.meta}, google=${counts.google}, website=${counts.website}`);

  let accepted = 0, duplicate = 0, skipped = 0;

  for (let i = 0; i < sheetRows.length; i++) {
    const row = sheetRows[i];
    const phone_e164 = normalizePhone(row.phone);
    const full_name = cleanText(row.name, 200);

    if (!phone_e164 || !full_name) {
      skipped++;
      console.log(`[import] skipped (bad name/phone): ${JSON.stringify(row)}`);
      continue;
    }

    let developer_name = cleanText(row.builder_name, 200);
    if (!developer_name && row.status_or_note && !/^book/i.test(row.status_or_note)) {
      developer_name = cleanText(row.status_or_note, 200);
    }

    const { outcome } = await insertLead({
      full_name,
      phone_raw: String(row.phone),
      phone_e164,
      developer_name,
      source: sources[i],
      entry_method: 'manual',
      created_by: 'system',
      is_test: false,
      submitted_at: parseSubmittedAt(row.sheet_date),
      raw_payload: { batch: BATCH_TAG, original: row },
    });

    if (outcome === 'duplicate') duplicate++;
    else accepted++;
  }

  console.log(`\n[import] done: ${accepted} accepted, ${duplicate} flagged duplicate (same phone, still stored), ${skipped} skipped.`);
  await closeDb();
}

main().catch((err) => {
  console.error('[import] failed:', err);
  process.exit(1);
});
