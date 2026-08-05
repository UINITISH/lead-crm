/**
 * End-to-end test against the Phase 1 acceptance criteria.
 * Runs on PGlite, so it needs no Postgres server and no ad accounts.
 *
 *   npm run test:e2e
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Kept out of the repo dir on purpose — some mounted/CI filesystems refuse the
// unlink() that PGlite does on teardown.
const TEST_DIR = path.join(os.tmpdir(), `cr-crm-test-${process.pid}`);

process.env.DATABASE_URL = '';
process.env.PGLITE_DIR = TEST_DIR;
process.env.PORT = process.env.TEST_PORT || '3999';
process.env.WEBSITE_INGEST_SECRET = 'test-secret';
process.env.GOOGLE_WEBHOOK_KEY = 'test-google-key';
process.env.META_APP_SECRET = 'test-meta-secret';
process.env.META_VERIFY_TOKEN = 'test-verify';
process.env.SESSION_SECRET = 'test-session-secret';
// migrate() creates exactly one default business on first boot, using these —
// deliberately test-specific rather than the real nk7823454@gmail.com default,
// so this suite never depends on (or could ever touch) production data.
process.env.DEFAULT_BUSINESS_NAME = 'Test Business One';
process.env.DEFAULT_BUSINESS_EMAIL = 'business-one@test.local';

await rm(TEST_DIR, { recursive: true, force: true });

const { start } = await import('../src/server.js');
const { processLeadgen } = await import('../src/routes/meta.js');
const { closeDb } = await import('../src/db.js');
const { upsertBusiness } = await import('../src/auth.js');
const { seedDefaultTags } = await import('../src/tags.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const server = await start();

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`  \x1b[32mPASS\x1b[0m ${name}`); }
  else    { fail++; console.log(`  \x1b[31mFAIL\x1b[0m ${name}${detail ? ' — ' + detail : ''}`); }
}

const sign = (body, secret) => crypto.createHmac('sha256', secret).update(body).digest('hex');

// migrate() (called by start()) already created "business-one@test.local"
// with no password — set one now so this suite can actually log in as it,
// the same way scripts/create-business.js would for a real client.
const { business: businessOne } = await upsertBusiness({
  name: 'Test Business One', email: 'business-one@test.local', password: 'test-password-one',
});

async function login(email, password) {
  const r = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`login failed for ${email}: ${j.error}`);
  return j.token;
}

const TOKEN = await login('business-one@test.local', 'test-password-one');
const admin = (p, tok = TOKEN) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + tok } }).then(r => r.json());

console.log('\n=== Acceptance criteria ===\n');

// ---------------------------------------------------------------------------
// 1. Website form -> leads table
// ---------------------------------------------------------------------------
{
  const payload = {
    full_name: 'Rohit Sharma',
    phone: '98765 43210',
    email: 'ROHIT@Example.com ',
    budget_range: '1.5-2 Cr',
    timeline: 'within 3 months',
    attribution: JSON.stringify({
      first_touch: { utm_source: 'facebook', utm_medium: 'paid_social', utm_campaign: 'Launch-Phase1' },
      last_touch:  { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Brand-Search', gclid: 'Cj0KCQtest' },
      sessions: 3,
    }),
  };
  const body = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': sign(body, 'test-secret') },
    body,
  });
  const j = await r.json();
  check('Website form submission is stored', r.status === 201 && j.ok, JSON.stringify(j));

  const { lead } = await admin(`/api/admin/leads/${j.lead_id}`);
  check('  phone normalised to E.164', lead.phone_e164 === '+919876543210', lead.phone_e164);
  check('  email normalised', lead.email === 'rohit@example.com', String(lead.email));
  check('  last-touch attribution captured', lead.gclid === 'Cj0KCQtest' && lead.utm_campaign === 'Brand-Search',
        `${lead.gclid} / ${lead.utm_campaign}`);
  check('  source inferred from gclid, not guessed', lead.source === 'google', lead.source);
  check('  first touch preserved for multi-touch reporting',
        lead.first_touch?.utm_source === 'facebook', JSON.stringify(lead.first_touch));
  check('  raw_payload stored', !!lead.raw_payload && lead.raw_payload.full_name === 'Rohit Sharma');
  check('  lifecycle event written on creation', lead.events?.length === 1, String(lead.events?.length));
}

// ---------------------------------------------------------------------------
// 2. Unsigned / bot traffic is rejected
// ---------------------------------------------------------------------------
{
  const body = JSON.stringify({ full_name: 'Bot', phone: '9000000001' });
  const r = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  check('Unsigned website POST is rejected', r.status === 401, `got ${r.status}`);
}
{
  const payload = { full_name: 'Bot2', phone: '9000000002', company_website: 'http://spam.example' };
  const body = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': sign(body, 'test-secret') },
    body,
  });
  const j = await r.json();
  check('Honeypot submission is silently dropped', r.status === 200 && !j.lead_id);
}
{
  const payload = { full_name: 'Junk', phone: '12345' };
  const body = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': sign(body, 'test-secret') },
    body,
  });
  check('Invalid phone number is rejected', r.status === 400, `got ${r.status}`);
}

// ---------------------------------------------------------------------------
// 3. Meta Lead Ads webhook
// ---------------------------------------------------------------------------
{
  // Handshake — this is the exact call Meta's reviewers make.
  const r = await fetch(`${BASE}/api/leads/meta/webhook?hub.mode=subscribe&hub.verify_token=test-verify&hub.challenge=42`);
  check('Meta subscription handshake returns the challenge',
        r.status === 200 && (await r.text()) === '42');

  const bad = await fetch(`${BASE}/api/leads/meta/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42`);
  check('Meta handshake rejects a wrong verify token', bad.status === 403);
}
{
  const body = JSON.stringify({ object: 'page', entry: [{ changes: [{ field: 'leadgen', value: { leadgen_id: 'x' } }] }] });
  const r = await fetch(`${BASE}/api/leads/meta/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
  });
  check('Meta webhook rejects an unsigned payload', r.status === 401, `got ${r.status}`);

  const signed = await fetch(`${BASE}/api/leads/meta/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + sign(body, 'test-meta-secret') },
    body,
  });
  check('Meta webhook ACKs a signed payload immediately (200)', signed.status === 200);
}
{
  // Drive the processor with a stubbed Graph API response.
  const stub = async (id) => ({
    id,
    created_time: '2026-07-30T10:15:00+0000',
    campaign_id: '120210', campaign_name: 'CoreRealty | Aquapolis | Lead Gen',
    adset_id: '120211',   adset_name: 'Gurgaon | 30-50 | Interest-RealEstate',
    ad_id: '120212',      ad_name: '3BHK-Carousel-v2',
    form_id: '77001',
    field_data: [
      { name: 'full_name', values: ['Anita Desai'] },
      { name: 'phone_number', values: ['+91 91234 56789'] },
      { name: 'email', values: ['anita@example.com'] },
      { name: 'budget', values: ['2-3 Cr'] },
    ],
  });

  const lead = await processLeadgen({ leadgen_id: 'LEAD_1001', form_id: '77001' }, stub);
  check('Meta lead is stored via Graph API pull', !!lead && lead.source === 'meta');
  check('  campaign captured', lead.campaign_name === 'CoreRealty | Aquapolis | Lead Gen', String(lead.campaign_name));
  check('  ad set captured', lead.adset_name?.includes('Gurgaon'), String(lead.adset_name));
  check('  creative captured', lead.ad_name === '3BHK-Carousel-v2', String(lead.ad_name));
  check('  phone normalised', lead.phone_e164 === '+919123456789', lead.phone_e164);

  // Meta retries. This must not create a second row.
  const replay = await processLeadgen({ leadgen_id: 'LEAD_1001', form_id: '77001' }, stub);
  check('Meta webhook retry does NOT duplicate the lead', replay.id === lead.id);
}

// ---------------------------------------------------------------------------
// 4. Google Ads lead form webhook (native, no Zapier)
// ---------------------------------------------------------------------------
{
  const payload = {
    lead_id: 'GLEAD_2001',
    api_version: '1.0',
    form_id: 8801, campaign_id: 990011, adgroup_id: 990012, creative_id: 990013,
    gcl_id: 'Cj0KCQjw-google',
    google_key: 'test-google-key',
    is_test: false,
    user_column_data: [
      { column_id: 'FULL_NAME', string_value: 'Vikram Nair' },
      { column_id: 'PHONE_NUMBER', string_value: '+919812345678' },
      { column_id: 'EMAIL', string_value: 'vikram@example.com' },
    ],
  };
  const r = await fetch(`${BASE}/api/leads/google/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  const j = await r.json();
  check('Google lead form submission is stored', r.status === 200 && j.ok && j.lead_id);

  const { lead } = await admin(`/api/admin/leads/${j.lead_id}`);
  check('  source = google', lead.source === 'google');
  check('  campaign / ad group / creative captured',
        lead.campaign_id === '990011' && lead.adset_id === '990012' && lead.ad_id === '990013');
  check('  gclid captured', lead.gclid === 'Cj0KCQjw-google');

  const badKey = await fetch(`${BASE}/api/leads/google/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, lead_id: 'GLEAD_2002', google_key: 'wrong' }),
  });
  check('Google webhook rejects a wrong google_key', badKey.status === 401);

  // Google's "Send test data" button.
  await fetch(`${BASE}/api/leads/google/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, lead_id: 'GLEAD_TEST', is_test: true,
      user_column_data: [{ column_id:'FULL_NAME', string_value:'Test' }, { column_id:'PHONE_NUMBER', string_value:'9811111111' }] }),
  });
  const list = await admin('/api/admin/leads');
  check('Google test-data leads are excluded from the default list',
        !list.leads.some(l => l.platform_lead_id === 'GLEAD_TEST'));
}

// ---------------------------------------------------------------------------
// 5. Dedupe
// ---------------------------------------------------------------------------
{
  const payload = { full_name: 'Rohit Sharma', phone: '+91-98765-43210', email: 'rohit@example.com' };
  const body = JSON.stringify(payload);
  const r = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': sign(body, 'test-secret') },
    body,
  });
  const j = await r.json();
  check('Same person re-submitting is flagged as a duplicate', j.duplicate === true);

  const list = await admin('/api/admin/leads');
  const rohits = list.leads.filter(l => l.phone_e164 === '+919876543210');
  check('  duplicates excluded from the reportable list', rohits.length === 1, `${rohits.length} rows`);
}

// ---------------------------------------------------------------------------
// 6. Lifecycle + reporting
// ---------------------------------------------------------------------------
{
  const list = await admin('/api/admin/leads');
  const target = list.leads[0];
  await fetch(`${BASE}/api/admin/leads/${target.id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify({ status: 'site_visit', note: 'Visited Tower B', actor: 'priya' }),
  });
  const { lead } = await admin(`/api/admin/leads/${target.id}`);
  check('Status change is applied', lead.status === 'site_visit');
  check('  status change recorded in the lifecycle trail with an actor',
        lead.events.some(e => e.event_type === 'status_change' && e.actor === 'priya'));

  const rep = await admin('/api/admin/report/source');
  check('Source report groups by source and campaign', rep.rows.length > 0);
  const sources = new Set(rep.rows.map(r => r.source));
  check('  all three sources present', ['meta','google','website'].every(s => sources.has(s)),
        [...sources].join(','));

  const ing = await admin('/api/admin/report/ingest');
  check('Ingest log records rejections for reconciliation',
        ing.rows.some(r => r.outcome === 'rejected'));
}

// ---------------------------------------------------------------------------
// 7. Auth + export
// ---------------------------------------------------------------------------
{
  const r = await fetch(`${BASE}/api/admin/leads`);
  check('Admin API requires a token', r.status === 401);

  const bad = await fetch(`${BASE}/api/admin/leads`, { headers: { Authorization: 'Bearer garbage' } });
  check('Admin API rejects a bogus/tampered token', bad.status === 401);

  const wrongPw = await fetch(`${BASE}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'business-one@test.local', password: 'wrong-password' }),
  });
  check('Login rejects the wrong password', wrongPw.status === 401);

  const csv = await fetch(`${BASE}/api/admin/export.csv?token=${TOKEN}`);
  const text = await csv.text();
  check('CSV export works and includes attribution columns',
        csv.status === 200 && text.includes('campaign_name') && text.includes('gclid'));
}

// ---------------------------------------------------------------------------
// 8. Multi-tenant isolation — a second business must never see the first
// business's data, and vice versa, across every scoped resource.
// ---------------------------------------------------------------------------
{
  const { business: businessTwo } = await upsertBusiness({
    name: 'Test Business Two', email: 'business-two@test.local', password: 'test-password-two',
  });
  // scripts/create-business.js also seeds default tags for a newly provisioned
  // business — do the same here so this suite exercises the real onboarding path.
  await seedDefaultTags(businessTwo.id);
  const tokenTwo = await login('business-two@test.local', 'test-password-two');
  check('A second business gets its own id', businessTwo.id !== businessOne.id);

  // Business Two starts with its own seeded default tags (seedDefaultTags
  // runs at provisioning) but zero of Business One's leads/deals/forms/tickets.
  const leadsTwo = await admin('/api/admin/leads', tokenTwo);
  check('New business sees zero of the other business\'s leads', leadsTwo.leads.length === 0, String(leadsTwo.leads.length));

  const dealsTwo = await admin('/api/admin/deals', tokenTwo);
  check('New business sees zero of the other business\'s deals', dealsTwo.deals.length === 0, String(dealsTwo.deals.length));

  const formsTwo = await admin('/api/admin/forms', tokenTwo);
  check('New business sees zero of the other business\'s forms', formsTwo.forms.length === 0, String(formsTwo.forms.length));

  const ticketsTwo = await admin('/api/admin/tickets', tokenTwo);
  check('New business sees zero of the other business\'s tickets', ticketsTwo.tickets.length === 0, String(ticketsTwo.tickets.length));

  const repsTwo = await admin('/api/admin/reps', tokenTwo);
  check('New business sees zero of the other business\'s reps', repsTwo.reps.length === 0, String(repsTwo.reps.length));

  const tagsOne = await admin('/api/admin/tags');
  const tagsTwo = await admin('/api/admin/tags', tokenTwo);
  check('Each business gets its own seeded default tags, not a shared list',
        tagsOne.tags.length > 0 && tagsTwo.tags.length > 0 && tagsOne.tags[0].id !== tagsTwo.tags[0].id);

  // Create a lead as Business Two, confirm Business One's list still doesn't see it.
  const payloadTwo = { full_name: 'Isolation Test', phone: '9811122233' };
  const bodyTwo = JSON.stringify(payloadTwo);
  const createR = await fetch(`${BASE}/api/leads/website`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CRM-Signature': sign(bodyTwo, 'test-secret') },
    body: bodyTwo,
  });
  const createJ = await createR.json();
  // The website webhook is single-account (attributes to the FIRST-created
  // business — see getDefaultBusinessId in auth.js), so this lands on
  // Business One, not Two. Confirm that's really where it landed, and that
  // Business Two still can't see it by guessing the id.
  check('Website webhook lead is attributed to the default (first) business', createR.status === 201 && createJ.ok);
  const crossRead = await admin(`/api/admin/leads/${createJ.lead_id}`, tokenTwo);
  check('Business Two cannot read a lead belonging to Business One by id', crossRead.ok === false, JSON.stringify(crossRead));
  const ownRead = await admin(`/api/admin/leads/${createJ.lead_id}`);
  check('Business One can read its own lead', ownRead.ok === true && ownRead.lead.id === createJ.lead_id);

  // Cross-business writes on a real resource id must also fail closed, not
  // silently succeed against the wrong tenant.
  const crossDelete = await fetch(`${BASE}/api/admin/leads/${createJ.lead_id}`, {
    method: 'DELETE', headers: { Authorization: 'Bearer ' + tokenTwo },
  }).then(r => r.json());
  check('Business Two cannot delete a lead belonging to Business One', crossDelete.ok === false, JSON.stringify(crossDelete));
  const stillThere = await admin(`/api/admin/leads/${createJ.lead_id}`);
  check('  and the lead is still there afterwards', stillThere.ok === true);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
server.close();
await closeDb();
await rm(TEST_DIR, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
