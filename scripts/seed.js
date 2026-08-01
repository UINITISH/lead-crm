/**
 * Seeds realistic sample leads so the UI has something in it during a demo.
 * Idempotent-ish: skips if leads already exist. Never run against production.
 *
 *   npm run seed
 *   npm run seed -- --force     (wipe and reseed)
 */
import 'dotenv/config';
import { initDb, query, closeDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { insertLead, updateStatus } from '../src/leads.js';

const force = process.argv.includes('--force');

await initDb();
await migrate();

const existing = await query(`SELECT COUNT(*)::int AS n FROM leads`);
if (existing.rows[0].n > 0 && !force) {
  console.log(`[seed] ${existing.rows[0].n} leads already present — skipping. Use --force to reseed.`);
  await closeDb();
  process.exit(0);
}
if (force) {
  await query(`TRUNCATE lead_events, ingest_log, leads RESTART IDENTITY CASCADE`);
  await query(`DELETE FROM projects`);
  console.log('[seed] wiped existing data');
}

const proj = await query(
  `INSERT INTO projects (name, location, price_range, inventory_notes)
   VALUES ('Aquapolis', 'Sector 79, Gurgaon', '1.4 - 3.2 Cr', '3BHK and 4BHK, towers B and C releasing')
   RETURNING id`,
);
const projectId = proj.rows[0].id;

const daysAgo = (d, h = 12) => {
  const t = new Date();
  t.setDate(t.getDate() - d);
  t.setHours(h, Math.floor(Math.random() * 60), 0, 0);
  return t.toISOString();
};

const META = {
  campaign_id: '120210', campaign_name: 'Aquapolis | Lead gen | Jul',
  adset_id: '120211', adset_name: 'Gurgaon | 30-50 | interest-real-estate',
  ad_id: '120212', ad_name: '3BHK-carousel-v2', form_id: '77001',
  utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'Aquapolis | Lead gen | Jul',
};
const META_LAL = {
  ...META, adset_id: '120215', adset_name: 'Delhi NCR | lookalike-1%',
  ad_id: '120216', ad_name: '4BHK-single-image',
};
const META_RT = {
  campaign_id: '120240', campaign_name: 'Aquapolis | Retargeting',
  adset_id: '120241', adset_name: 'Site visitors 30d',
  ad_id: '120242', ad_name: 'retarget-video-15s', form_id: '77002',
  utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'Aquapolis | Retargeting',
};
const GOOG = {
  campaign_id: '990011', campaign_name: 'Search | Flats in Gurgaon | Exact',
  adset_id: '990012', adset_name: 'ag-3bhk-gurgaon',
  ad_id: '990013', ad_name: 'rsa-v4', form_id: '8801',
  utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Search | Flats in Gurgaon | Exact',
};
const GOOG_BRAND = {
  ...GOOG, campaign_id: '990030', campaign_name: 'Search | Brand',
  adset_id: '990031', adset_name: 'ag-brand-exact', ad_id: '990032', ad_name: 'brand-search',
};

const samples = [
  { n: 'Anita Desai',     p: '+91 91234 56789', e: 'anita@example.com',  b: '2-3 Cr',   t: 'within 3 months',   s: 'meta',    id: 'l_88213004', a: META,       d: 1, to: 'site_visit',  note: 'Booked for Sat 11am, tower B' },
  { n: 'Vikram Nair',     p: '+919812345678',   e: 'vikram@example.com', b: '1.5-2 Cr', t: 'within 6 months',   s: 'google',  id: 'g_5510221',  a: GOOG,       d: 1, to: 'contacted',   note: 'Wants Sector 79 only', gclid: 'Cj0KCQjw8vqzBhCr' },
  { n: 'Priya Menon',     p: '98765 00011',     e: 'priya@example.com',  b: '3 Cr+',    t: 'immediate',         s: 'website', id: null,         a: META_RT,    d: 2, to: 'closed',      note: 'Unit C-1704 booked',
    landing_page: 'https://corerealty.example/aquapolis?utm_source=facebook&utm_campaign=Aquapolis%20%7C%20Retargeting',
    referrer: 'https://l.facebook.com/',
    first_touch: { utm_source: 'google', utm_medium: 'organic', captured_at: daysAgo(18) } },
  { n: 'Rohit Sharma',    p: '+91-98765-43210', e: 'rohit@example.com',  b: '1.5-2 Cr', t: 'within 3 months',   s: 'google',  id: 'g_5510188',  a: GOOG_BRAND, d: 2, gclid: 'Cj0KCQjw8vqzBhDx',
    first_touch: { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'Aquapolis | Lead gen | Jul', captured_at: daysAgo(10) } },
  // Same human as Rohit above, arriving again from a Meta ad. Should dedupe.
  { n: 'Rohit Sharma',    p: '9876543210',      e: 'rohit@example.com',  b: '1.5-2 Cr', t: null,                s: 'meta',    id: 'l_88209911', a: META,       d: 2 },
  { n: 'Sanjana Rao',     p: '+91 98451 12233', e: null,                 b: '1-1.5 Cr', t: 'within 6 months',   s: 'meta',    id: 'l_88201772', a: META_RT,    d: 3, to: 'contacted' },
  { n: 'Karan Bhatia',    p: '9701234567',      e: 'karan@example.com',  b: '2-3 Cr',   t: 'within 3 months',   s: 'website', id: null,         a: {},         d: 3, to: 'site_visit',
    utm_source: 'google', utm_medium: 'organic',
    landing_page: 'https://corerealty.example/projects/aquapolis', referrer: 'https://www.google.com/' },
  { n: 'Meera Iyer',      p: '+919900112244',   e: 'meera@example.com',  b: '1.5-2 Cr', t: 'within 12 months',  s: 'google',  id: 'g_5509004',  a: GOOG,       d: 4, to: 'dropped', note: 'Budget mismatch, wants under 1 Cr', gclid: 'Cj0KCQjw8vqzBhAa' },
  { n: 'Aditya Verma',    p: '9555667788',      e: null,                 b: '2-3 Cr',   t: 'immediate',         s: 'meta',    id: 'l_88190043', a: META_LAL,   d: 4, to: 'negotiation', note: 'Asking 8% off list' },
  { n: 'Neha Gupta',      p: '+91 98182 23344', e: 'neha@example.com',   b: '3 Cr+',    t: 'within 3 months',   s: 'website', id: null,         a: {},         d: 5, to: 'contacted',
    utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Search | Flats in Gurgaon | Exact', gclid: 'Cj0KCQjw8vqzBhZZ',
    landing_page: 'https://corerealty.example/aquapolis?gclid=Cj0KCQjw8vqzBhZZ',
    first_touch: { utm_source: 'facebook', utm_medium: 'paid_social', captured_at: daysAgo(13) } },
  { n: 'Farhan Qureshi',  p: '9833445566',      e: null,                 b: '1-1.5 Cr', t: 'within 6 months',   s: 'meta',    id: 'l_88177201', a: META_RT,    d: 5 },
  { n: 'Deepak Joshi',    p: '+919867112299',   e: 'deepak@example.com', b: '2-3 Cr',   t: 'within 12 months',  s: 'website', id: null,         a: {},         d: 6,
    utm_source: 'direct', utm_medium: 'none', landing_page: 'https://corerealty.example/contact' },
  { n: 'Ritu Malhotra',   p: '+91 99871 20034', e: 'ritu@example.com',   b: '2-3 Cr',   t: 'within 3 months',   s: 'meta',    id: 'l_88166540', a: META,       d: 7, to: 'site_visit' },
  { n: 'Sameer Kulkarni', p: '9820014477',      e: null,                 b: '1.5-2 Cr', t: 'within 6 months',   s: 'google',  id: 'g_5507712',  a: GOOG,       d: 8, to: 'contacted', gclid: 'Cj0KCQjw8vqzBhQq' },
];

let accepted = 0, dupes = 0;

for (const s of samples) {
  const attribution = { ...s.a };
  if (s.utm_source)   attribution.utm_source   = s.utm_source;
  if (s.utm_medium)   attribution.utm_medium   = s.utm_medium;
  if (s.utm_campaign) attribution.utm_campaign = s.utm_campaign;

  const payload = {
    full_name: s.n,
    phone_raw: s.p,
    phone_e164: s.p.replace(/\D/g, '').replace(/^(?:0|91)?(\d{10})$/, '+91$1'),
    email: s.e,
    budget_range: s.b,
    timeline: s.t,
    project_id: projectId,
    source: s.s,
    platform_lead_id: s.id,
    ...attribution,
    gclid: s.gclid ?? null,
    landing_page: s.landing_page ?? null,
    referrer: s.referrer ?? null,
    first_touch: s.first_touch ?? null,
    submitted_at: daysAgo(s.d),
  };

  const { lead, outcome } = await insertLead({ ...payload, raw_payload: payload });

  // Backdate so the list doesn't show 14 leads all created this second.
  await query(`UPDATE leads SET created_at = $2 WHERE id = $1`, [lead.id, daysAgo(s.d)]);

  if (outcome === 'duplicate') { dupes++; }
  else {
    accepted++;
    if (s.to) await updateStatus(lead.id, s.to, { actor: ['priya', 'arjun'][accepted % 2], note: s.note });
  }
}

console.log(`[seed] ${accepted} unique leads, ${dupes} duplicate(s) flagged`);
console.log('[seed] done — run "npm start" and open http://localhost:3400');
await closeDb();
