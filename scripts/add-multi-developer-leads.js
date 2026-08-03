/**
 * Adds 3 sample leads, each interested in a MIX of developers rather than one
 * builder — the kind of client who's comparing 2-3 options in the same part
 * of town before deciding. All three are set to East Bangalore, pulling real
 * developers who actually have projects in that belt per the imported
 * catalog (Whitefield-Kadugodi / Varthur-Panathur / Sarjapur / Bellandur-HSR):
 *
 *   1. Prestige Group + Sumadhura Group        (Whitefield-Kadugodi)
 *   2. Sobha Limited + Godrej Properties       (Varthur/Panathur + Sarjapur)
 *   3. Assetz Property Group + Sattva Group    (Bellandur-HSR + KR Puram)
 *
 * Leads have no dedicated "area" column, so the region is recorded in
 * project_name (closest fit) — e.g. "East Bangalore (Whitefield belt)".
 * developer_name holds the comma-separated mix as free text, same as the
 * real "tru, mana, other" pattern already seen in the registered-leads import.
 *
 * These are real, visible leads (is_test = FALSE) so they show up on the
 * Leads page like any other entry — tagged with raw_payload.batch so they
 * can still be found and removed later with one query if they turn out not
 * to be wanted.
 *
 * Usage:  node scripts/add-multi-developer-leads.js
 */
import { migrate } from '../src/migrate.js';
import { insertLead } from '../src/leads.js';
import { normalizePhone, cleanText } from '../src/normalize.js';
import { query, closeDb } from '../src/db.js';

const BATCH_TAG = 'multi-developer-sample-east-blr';

const SAMPLE_LEADS = [
  {
    full_name: 'Ananya Rao',
    phone: '9741122334',
    developer_name: 'Prestige Group, Sumadhura Group',
    project_name: 'East Bangalore (Whitefield-Kadugodi belt)',
    source: 'website',
  },
  {
    full_name: 'Kiran Shetty',
    phone: '9845566778',
    developer_name: 'Sobha Limited, Godrej Properties',
    project_name: 'East Bangalore (Varthur/Panathur + Sarjapur belt)',
    source: 'meta',
  },
  {
    full_name: 'Deepa Menon',
    phone: '9900112233',
    developer_name: 'Assetz Property Group, Sattva Group',
    project_name: 'East Bangalore (Bellandur-HSR + KR Puram belt)',
    source: 'google',
  },
];

async function main() {
  await migrate();

  const already = await query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE raw_payload->>'batch' = $1`,
    [BATCH_TAG],
  );
  if (already.rows[0].n > 0) {
    console.log(`[add-multi-developer-leads] batch '${BATCH_TAG}' already added (${already.rows[0].n} leads) — skipping.`);
    await closeDb();
    return;
  }

  for (const sample of SAMPLE_LEADS) {
    const phone_e164 = normalizePhone(sample.phone);
    const { lead, outcome } = await insertLead({
      full_name: cleanText(sample.full_name, 200),
      phone_raw: sample.phone,
      phone_e164,
      developer_name: sample.developer_name,
      project_name: sample.project_name,
      source: sample.source,
      entry_method: 'manual',
      created_by: 'admin',
      is_test: false,
      raw_payload: { batch: BATCH_TAG, note: 'Sample multi-developer lead, East Bangalore' },
    });
    console.log(`[add-multi-developer-leads] ${outcome}: ${lead.full_name} — ${lead.developer_name} — ${lead.project_name}`);
  }

  console.log('\n[add-multi-developer-leads] done. These leads are real (is_test = false) and will show up on the Leads page and dashboard like any other entry.');
  await closeDb();
}

main().catch((err) => {
  console.error('[add-multi-developer-leads] failed:', err);
  process.exit(1);
});
