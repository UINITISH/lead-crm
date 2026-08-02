/**
 * Quick diagnostic: what's actually in the local database right now.
 * Run: node scripts/diagnose-leads.js
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';

await initDb();

const total = await query(`SELECT COUNT(*)::int AS n FROM leads`);
console.log('Total leads:', total.rows[0].n);

const byBatch = await query(
  `SELECT COALESCE(raw_payload->>'batch', '(no batch tag)') AS batch, COUNT(*)::int AS n
     FROM leads GROUP BY 1 ORDER BY n DESC`,
);
console.log('By batch tag:');
byBatch.rows.forEach(r => console.log(' ', r.batch, '->', r.n));

const sample = await query(
  `SELECT full_name, created_at, raw_payload FROM leads ORDER BY created_at DESC LIMIT 3`,
);
console.log('Most recent 3 leads:');
sample.rows.forEach(r => console.log(' ', r.full_name, '|', r.created_at, '|', JSON.stringify(r.raw_payload)));

await closeDb();
