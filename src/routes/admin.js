/**
 * Admin API — one login per client business, not a shared token anymore.
 *
 * POST /auth/login is the only unauthenticated route on this router; every
 * other route requires a valid session token (see src/auth.js) and runs
 * scoped to req.business_id, which the session middleware below sets from
 * that token. There is no cross-business admin route — provisioning a new
 * business is a local CLI script (scripts/create-business.js), not an API
 * endpoint, so there's no "super-admin" web surface to secure separately.
 */
import express from 'express';
import {
  listLeads, getLead, updateStatus, updateLead, deleteLead, sourceReport, insertLead, logIngest, addEvent,
  listRecentActivity, leaderboard, dashboardStats,
} from '../leads.js';
import { query as raw } from '../db.js';
import {
  listDevelopers, listProjects, findOrCreateDeveloper, findOrCreateProject, seedDeveloperDirectory,
} from '../developers.js';
import {
  createFollowUp, listUpcoming, listForLead, markDone, updateFollowUp,
} from '../followups.js';
import {
  createDeal, listDeals, listForLead as listDealsForLead, getDeal, updateDeal, dealStats,
  getBooking,
  addApplicant, updateApplicant, deleteApplicant,
  addCostItem, updateCostItem, deleteCostItem,
  addMilestone, updateMilestone, deleteMilestone,
  addDocument, updateDocument, deleteDocument,
} from '../deals.js';
import {
  listSettings, setSetting, getIntegrationStatus, getDataStats, wipeTestLeads,
} from '../settings.js';
import { listReps, createRep, updateRep } from '../reps.js';
import { listTags, createTag, updateTag } from '../tags.js';
import { listForms, createForm, updateForm, deleteForm, sanitizeFields } from '../forms.js';
import { renderFormPreview } from './publicForm.js';
import {
  createTicket, listTickets, getTicket, updateTicket, deleteTicket, ticketStats,
} from '../tickets.js';
import { normalizePhone, normalizeEmail, cleanText } from '../normalize.js';
import { authenticateBusiness, issueSessionToken, verifySessionToken, findBusinessBySlug, getEffectiveHiddenPages } from '../auth.js';

const toNum = (v) => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const adminRouter = express.Router();

/**
 * POST /auth/login — the one route on this router that runs before the
 * session-check middleware below, so it's the only one reachable without
 * already being logged in.
 */
adminRouter.post('/auth/login', async (req, res) => {
  const { email, password, slug } = req.body || {};
  if (!cleanText(email) || !password) {
    return res.status(400).json({ ok: false, error: 'Email and password are required' });
  }
  const business = await authenticateBusiness(email, password);
  if (!business) return res.status(401).json({ ok: false, error: 'Incorrect email or password' });
  // A vanity login link (findmigo.com/<slug>) is scoped to one business — if
  // this attempt came in on someone else's link, refuse it rather than
  // silently logging them into the account the URL points at.
  if (slug && business.slug !== slug) {
    return res.status(401).json({ ok: false, error: 'This login link belongs to a different account' });
  }
  const token = issueSessionToken(business, business.login_id ?? null);
  res.json({
    ok: true,
    token,
    business: { id: business.id, name: business.name, email: business.email, hidden_pages: business.hidden_pages || [] },
  });
});

/** Public — lets the login page show "Sign in to <business>" for a vanity URL, without exposing anything sensitive. */
adminRouter.get('/business-by-slug/:slug', async (req, res) => {
  const business = await findBusinessBySlug(req.params.slug);
  if (!business) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, business: { name: business.name, slug: business.slug } });
});

/** Every route below this line requires a valid session and runs scoped to req.business_id. */
adminRouter.use(async (req, res, next) => {
  const given = (req.get('Authorization') || '').replace(/^Bearer\s+/i, '') || req.query.token;
  const session = verifySessionToken(given);
  if (!session) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  req.business_id = session.business_id;
  req.login_id = session.login_id || null;
  // Re-checked on every request (rather than baked into the token) so a
  // restriction set via scripts/set-hidden-pages.js takes effect immediately
  // for anyone already logged in, not just on their next login. Scoped to
  // exactly which login this session was issued for, so restricting one
  // added login (business_logins) never affects the business's own primary
  // login, which shares the same underlying leads/data.
  try {
    req.hidden_pages = await getEffectiveHiddenPages(req.business_id, req.login_id);
  } catch {
    req.hidden_pages = [];
  }
  next();
});

/**
 * Gate for routes that exclusively belong to something a login can be
 * restricted from (see businesses.hidden_pages / business_logins.hidden_pages,
 * and HIDEABLE_KEYS in scripts/set-hidden-pages.js) — either a whole NAV
 * page (mirrors the key in client/src/constants.js) or a narrower feature
 * inside a page that otherwise stays visible, like 'add_lead' (the manual
 * "Add Lead" button on the Leads page, which itself is never hideable).
 * Deliberately NOT applied to shared endpoints like /reps or /tags GET,
 * which other pages (the "Acting as" picker, the tag dropdown on every
 * lead) also depend on even when the Settings page itself is hidden.
 */
function blockIfHidden(key) {
  return (req, res, next) => {
    if (req.hidden_pages.includes(key)) {
      return res.status(403).json({ ok: false, error: 'This feature is not available on your account.' });
    }
    next();
  };
}

adminRouter.get('/leads', async (req, res) => {
  const rows = await listLeads(req.business_id, {
    source: req.query.source,
    status: req.query.status,
    tag: req.query.tag,
    campaign_id: req.query.campaign_id,
    entry_method: req.query.entry_method,
    developer_name: req.query.developer_name,
    from: req.query.from,
    to: req.query.to,
    q: req.query.q,
    include_duplicates: req.query.include_duplicates === '1',
    include_test: req.query.include_test === '1',
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json({ ok: true, count: rows.length, leads: rows });
});

/**
 * Manual lead entry.
 *
 * Exists for two real situations: someone calls in and a lead is logged by
 * hand, or a Meta/Google lead is downloaded as a CSV from the ads dashboard
 * and typed in rather than arriving over the webhook. In both cases `source`
 * is a deliberate choice made by the person entering it, not inferred — so a
 * CSV-uploaded Meta lead still reports as `meta`, same as one that arrived
 * live. Every insert here is flagged entry_method = 'manual' so reporting can
 * always tell manual entries apart from webhook-captured ones.
 */
adminRouter.post('/leads/manual', blockIfHidden('add_lead'), async (req, res) => {
  const body = req.body || {};
  const SOURCES = ['meta', 'google', 'website'];

  if (!SOURCES.includes(body.source)) {
    return res.status(400).json({ ok: false, error: `source must be one of ${SOURCES.join(', ')}`, field: 'source' });
  }

  const phone_e164 = normalizePhone(body.phone);
  if (!phone_e164) {
    return res.status(400).json({ ok: false, error: 'A valid phone number is required', field: 'phone' });
  }

  // Developer/project: accept an existing id, or a typed name to create on
  // the spot. Neither is required — a lead can be logged before the project
  // is pinned down and edited later. developers/projects is a SHARED catalog
  // across every business (public builder info), so no business_id check
  // here — but everything else below (the lead itself) is business-scoped.
  // A comma means multiple developers ("Prestige Group, Sumadhura Group") —
  // that's stored as free text on the lead only, same convention used
  // everywhere else, and deliberately never sent to findOrCreateDeveloper:
  // doing so would create a bogus directory entry literally named after the
  // whole combined string.
  let developer = null;
  const isMultiDeveloper = cleanText(body.developer_name)?.includes(',');
  if (body.developer_id) {
    developer = await raw(`SELECT * FROM developers WHERE id = $1`, [body.developer_id]).then((r) => r.rows[0]);
    if (!developer) return res.status(400).json({ ok: false, error: 'Unknown developer_id', field: 'developer_id' });
  } else if (cleanText(body.developer_name) && !isMultiDeveloper) {
    const grade = ['A', 'B'].includes(body.developer_grade) ? body.developer_grade : null;
    developer = await findOrCreateDeveloper(body.developer_name, grade);
  }

  let project = null;
  if (body.project_id) {
    project = await raw(`SELECT * FROM projects WHERE id = $1`, [body.project_id]).then((r) => r.rows[0]);
    if (!project) return res.status(400).json({ ok: false, error: 'Unknown project_id', field: 'project_id' });
  } else if (cleanText(body.project_name)) {
    project = await findOrCreateProject(body.project_name, developer?.id ?? null);
  }

  try {
    const { lead, outcome } = await insertLead(req.business_id, {
      full_name:    cleanText(body.full_name ?? body.name, 200),
      phone_raw:    cleanText(body.phone, 50),
      phone_e164,
      email:        normalizeEmail(body.email),
      budget_range: cleanText(body.budget_range ?? body.budget, 100),
      budget_min:   toNum(body.budget_min),
      budget_max:   toNum(body.budget_max),
      timeline:     cleanText(body.timeline, 100),
      project_id:      project?.id ?? null,
      developer_name:  developer?.name ?? cleanText(body.developer_name, 200),
      project_name:    project?.name ?? cleanText(body.project_name, 200),
      source: body.source,
      is_test: Boolean(body.is_test),
      entry_method: 'manual',
      created_by: cleanText(body.actor ?? body.created_by, 100) || 'admin',
      raw_payload: body,
      submitted_at: new Date().toISOString(),
    });

    if (cleanText(body.notes)) {
      await addEvent(req.business_id, lead.id, {
        event_type: 'note',
        note: cleanText(body.notes, 2000),
        actor: cleanText(body.actor ?? body.created_by, 100) || 'admin',
      });
    }

    await logIngest(req.business_id, { source: body.source, outcome, lead_id: lead.id, http_status: 201, payload: { ...body, manual: true } });
    return res.status(201).json({ ok: true, lead, duplicate: outcome === 'duplicate' });
  } catch (err) {
    console.error('[admin] manual lead insert failed:', err);
    return res.status(500).json({ ok: false, error: 'Could not save lead' });
  }
});

// developers/projects are a SHARED catalog across every business — no
// business_id scoping here, on purpose (see db/schema.sql's businesses note).
adminRouter.get('/developers', async (_req, res) => {
  res.json({ ok: true, developers: await listDevelopers() });
});

adminRouter.post('/developers', async (req, res) => {
  const name = (req.body || {}).name;
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const grade = ['A', 'B'].includes((req.body || {}).grade) ? req.body.grade : null;
  const developer = await findOrCreateDeveloper(name, grade);
  res.status(201).json({ ok: true, developer });
});

adminRouter.get('/projects', async (req, res) => {
  res.json({ ok: true, projects: await listProjects({ developer_id: req.query.developer_id || undefined }) });
});

adminRouter.post('/projects', async (req, res) => {
  const { name, developer_id } = req.body || {};
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const project = await findOrCreateProject(name, developer_id || null, req.body || {});
  res.status(201).json({ ok: true, project });
});

/** Dashboard activity feed: recent lifecycle events across every lead. */
adminRouter.get('/activity', async (req, res) => {
  res.json({ ok: true, activity: await listRecentActivity(req.business_id, { limit: req.query.limit }) });
});

/**
 * Who's working leads, ranked. Approximate until real per-staff accounts
 * exist — it's grouped by whatever name was set as "Acting as" for a
 * session, not a verified identity.
 */
adminRouter.get('/leaderboard', async (req, res) => {
  res.json({ ok: true, leaderboard: await leaderboard(req.business_id) });
});

/** Headline stats, pipeline stage breakdown, and an 8-week value trend, in one call. */
adminRouter.get('/dashboard-stats', async (req, res) => {
  res.json({ ok: true, stats: await dashboardStats(req.business_id) });
});

/** Upcoming follow-up reminders across all leads. */
adminRouter.get('/followups', async (req, res) => {
  res.json({ ok: true, followups: await listUpcoming(req.business_id, { limit: req.query.limit, includeDone: req.query.include_done === '1' }) });
});

adminRouter.get('/leads/:id/followups', async (req, res) => {
  res.json({ ok: true, followups: await listForLead(req.business_id, req.params.id) });
});

adminRouter.post('/leads/:id/followups', async (req, res) => {
  const { due_at, note, assigned_to, actor } = req.body || {};
  if (!due_at) return res.status(400).json({ ok: false, error: 'due_at is required', field: 'due_at' });
  const lead = await getLead(req.business_id, req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });

  const followup = await createFollowUp(req.business_id, {
    lead_id: req.params.id,
    due_at,
    note: cleanText(note, 500),
    assigned_to: cleanText(assigned_to, 100),
    created_by: cleanText(actor, 100) || 'admin',
  });
  await addEvent(req.business_id, req.params.id, {
    event_type: 'note',
    note: `Follow-up scheduled for ${new Date(due_at).toLocaleString('en-IN')}${note ? ': ' + note : ''}`,
    actor: cleanText(actor, 100) || 'admin',
  });
  res.status(201).json({ ok: true, followup });
});

adminRouter.patch('/followups/:id', async (req, res) => {
  const { done, due_at, note } = req.body || {};
  let followup;
  if (done !== undefined) {
    followup = await markDone(req.business_id, req.params.id, { done: Boolean(done) });
  } else {
    followup = await updateFollowUp(req.business_id, req.params.id, { due_at, note });
  }
  if (!followup) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, followup });
});

/**
 * Deals. A deal only makes sense once a lead is actually Closed — showing
 * the "Open deal" prompt on every Pickup/Not interested lead (which is what
 * happens if every status is eligible) is just clutter on leads that were
 * never going anywhere.
 */
const DEAL_ELIGIBLE_STATUSES = ['closed'];

adminRouter.get('/deals', async (req, res) => {
  res.json({ ok: true, deals: await listDeals(req.business_id, { stage: req.query.stage, limit: req.query.limit }) });
});

adminRouter.get('/deal-stats', async (req, res) => {
  res.json({ ok: true, stats: await dealStats(req.business_id) });
});

adminRouter.get('/deals/:id', async (req, res) => {
  const deal = await getDeal(req.business_id, req.params.id);
  if (!deal) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, deal });
});

adminRouter.get('/leads/:id/deals', async (req, res) => {
  res.json({ ok: true, deals: await listDealsForLead(req.business_id, req.params.id) });
});

adminRouter.post('/leads/:id/deals', async (req, res) => {
  const lead = await getLead(req.business_id, req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Lead not found' });
  if (!DEAL_ELIGIBLE_STATUSES.includes(lead.status)) {
    return res.status(400).json({
      ok: false,
      error: `A deal can't be opened for a lead at "${lead.status.replace('_', ' ')}".`,
    });
  }

  const { unit_number, agreed_price, expected_closing_date, notes, actor } = req.body || {};
  const deal = await createDeal(req.business_id, {
    lead_id: req.params.id,
    unit_number: cleanText(unit_number, 100),
    agreed_price: toNum(agreed_price),
    expected_closing_date: expected_closing_date || null,
    notes: cleanText(notes, 1000),
    created_by: cleanText(actor, 100) || 'admin',
  });
  res.status(201).json({ ok: true, deal });
});

adminRouter.patch('/deals/:id', async (req, res) => {
  const { stage, unit_number, agreed_price, expected_closing_date, notes, actor } = req.body || {};
  try {
    const deal = await updateDeal(req.business_id, req.params.id, {
      stage,
      unit_number: unit_number !== undefined ? cleanText(unit_number, 100) : undefined,
      agreed_price: agreed_price !== undefined ? toNum(agreed_price) : undefined,
      expected_closing_date: expected_closing_date !== undefined ? (expected_closing_date || null) : undefined,
      notes: notes !== undefined ? cleanText(notes, 1000) : undefined,
      actor: cleanText(actor, 100) || 'admin',
    });
    if (!deal) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, deal });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

/**
 * Bookings & payment tracking — sub-resources of a deal (applicants, cost
 * sheet, payment milestones, document checklist). GET /deals/:id/booking
 * returns all four plus rollup totals in one call for the booking panel;
 * each sub-resource also has its own add/update/delete routes.
 */
adminRouter.get('/deals/:id/booking', async (req, res) => {
  const booking = await getBooking(req.business_id, req.params.id);
  if (!booking) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, ...booking });
});

adminRouter.post('/deals/:id/applicants', async (req, res) => {
  const { full_name, relation, phone, email, pan, aadhaar, address, notes } = req.body || {};
  try {
    const applicant = await addApplicant(req.business_id, req.params.id, {
      full_name: cleanText(full_name, 200), relation,
      phone: cleanText(phone, 50), email: normalizeEmail(email),
      pan: cleanText(pan, 20), aadhaar: cleanText(aadhaar, 20),
      address: cleanText(address, 500), notes: cleanText(notes, 1000),
    });
    if (!applicant) return res.status(404).json({ ok: false, error: 'Not found' });
    res.status(201).json({ ok: true, applicant });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.patch('/deal-applicants/:id', async (req, res) => {
  const { full_name, relation, phone, email, pan, aadhaar, address, notes } = req.body || {};
  try {
    const applicant = await updateApplicant(req.business_id, req.params.id, {
      full_name: full_name !== undefined ? cleanText(full_name, 200) : undefined,
      relation,
      phone: phone !== undefined ? cleanText(phone, 50) : undefined,
      email: email !== undefined ? normalizeEmail(email) : undefined,
      pan: pan !== undefined ? cleanText(pan, 20) : undefined,
      aadhaar: aadhaar !== undefined ? cleanText(aadhaar, 20) : undefined,
      address: address !== undefined ? cleanText(address, 500) : undefined,
      notes: notes !== undefined ? cleanText(notes, 1000) : undefined,
    });
    if (!applicant) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, applicant });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.delete('/deal-applicants/:id', async (req, res) => {
  const ok = await deleteApplicant(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

adminRouter.post('/deals/:id/cost-items', async (req, res) => {
  const { label, amount } = req.body || {};
  try {
    const item = await addCostItem(req.business_id, req.params.id, { label: cleanText(label, 200), amount: toNum(amount) });
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    res.status(201).json({ ok: true, item });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.patch('/deal-cost-items/:id', async (req, res) => {
  const { label, amount } = req.body || {};
  const item = await updateCostItem(req.business_id, req.params.id, {
    label: label !== undefined ? cleanText(label, 200) : undefined,
    amount: amount !== undefined ? toNum(amount) : undefined,
  });
  if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, item });
});

adminRouter.delete('/deal-cost-items/:id', async (req, res) => {
  const ok = await deleteCostItem(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

adminRouter.post('/deals/:id/milestones', async (req, res) => {
  const { label, due_date, amount, notes } = req.body || {};
  try {
    const milestone = await addMilestone(req.business_id, req.params.id, {
      label: cleanText(label, 200), due_date: due_date || null, amount: toNum(amount), notes: cleanText(notes, 500),
    });
    if (!milestone) return res.status(404).json({ ok: false, error: 'Not found' });
    res.status(201).json({ ok: true, milestone });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.patch('/deal-milestones/:id', async (req, res) => {
  const { label, due_date, amount, paid_amount, paid_date, status, notes, actor } = req.body || {};
  try {
    const milestone = await updateMilestone(req.business_id, req.params.id, {
      label: label !== undefined ? cleanText(label, 200) : undefined,
      due_date: due_date !== undefined ? (due_date || null) : undefined,
      amount: amount !== undefined ? toNum(amount) : undefined,
      paid_amount: paid_amount !== undefined ? toNum(paid_amount) : undefined,
      paid_date: paid_date !== undefined ? (paid_date || null) : undefined,
      status,
      notes: notes !== undefined ? cleanText(notes, 500) : undefined,
    }, { actor: cleanText(actor, 100) || 'admin' });
    if (!milestone) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, milestone });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.delete('/deal-milestones/:id', async (req, res) => {
  const ok = await deleteMilestone(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

adminRouter.post('/deals/:id/documents', async (req, res) => {
  const { name, status, reference } = req.body || {};
  try {
    const document = await addDocument(req.business_id, req.params.id, { name: cleanText(name, 200), status, reference: cleanText(reference, 500) });
    if (!document) return res.status(404).json({ ok: false, error: 'Not found' });
    res.status(201).json({ ok: true, document });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.patch('/deal-documents/:id', async (req, res) => {
  const { name, status, reference } = req.body || {};
  try {
    const document = await updateDocument(req.business_id, req.params.id, {
      name: name !== undefined ? cleanText(name, 200) : undefined,
      status,
      reference: reference !== undefined ? cleanText(reference, 500) : undefined,
    });
    if (!document) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, document });
  } catch (err) { res.status(400).json({ ok: false, error: err.message }); }
});

adminRouter.delete('/deal-documents/:id', async (req, res) => {
  const ok = await deleteDocument(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

adminRouter.get('/leads/:id', async (req, res) => {
  const lead = await getLead(req.business_id, req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, lead });
});

/**
 * Edit an existing lead's business-facing fields (name/email/phone/source/
 * budget/timeline/developer/project/tag — see EDITABLE_LEAD_FIELDS in
 * leads.js). `tag` (Warm/Cold/Junk/Scheduled/…) is separate from `status`
 * (the pipeline stage) — use PATCH /leads/:id/status for that instead.
 * Multiple developers are supported as one comma-separated string in
 * `developer_name` ("Prestige Group, Sumadhura Group") — same free-text
 * convention already used by manual entry and the spreadsheet imports;
 * there's no separate join table to keep this simple. Every change lands in
 * the lead's activity thread as a note, so "who changed what, and to what"
 * stays answerable without a separate audit table. Campaign-level attribution
 * (campaign_id, adset, gclid, etc.) is deliberately NOT editable here — that
 * proves ad performance and is only ever set at ingestion time.
 */
adminRouter.patch('/leads/:id', async (req, res) => {
  const body = req.body || {};
  const fields = {};
  if ('full_name' in body)      fields.full_name = cleanText(body.full_name, 200);
  if ('email' in body)          fields.email = normalizeEmail(body.email);
  if ('budget_range' in body)   fields.budget_range = cleanText(body.budget_range, 100);
  if ('budget_min' in body)     fields.budget_min = toNum(body.budget_min);
  if ('budget_max' in body)     fields.budget_max = toNum(body.budget_max);
  if ('timeline' in body)       fields.timeline = cleanText(body.timeline, 100);
  if ('developer_name' in body) fields.developer_name = cleanText(body.developer_name, 300);
  if ('project_name' in body)   fields.project_name = cleanText(body.project_name, 200);
  // '' clears the tag — not validated against the managed list on purpose,
  // same reasoning as developer_name: a tag renamed or removed later in
  // Settings shouldn't retroactively invalidate what a lead was marked as.
  if ('tag' in body)            fields.tag = body.tag ? cleanText(body.tag, 100) : null;

  if ('phone' in body) {
    const phone_e164 = normalizePhone(body.phone);
    if (!phone_e164) return res.status(400).json({ ok: false, error: 'That doesn’t look like a valid phone number', field: 'phone' });
    fields.phone_raw = cleanText(body.phone, 50);
    fields.phone_e164 = phone_e164;
  }
  if ('source' in body) {
    const SOURCES = ['meta', 'google', 'website'];
    if (!SOURCES.includes(body.source)) {
      return res.status(400).json({ ok: false, error: `source must be one of ${SOURCES.join(', ')}`, field: 'source' });
    }
    fields.source = body.source;
  }

  if (!Object.keys(fields).length) {
    return res.status(400).json({ ok: false, error: 'No editable fields in request.' });
  }

  const result = await updateLead(req.business_id, req.params.id, fields);
  if (!result) return res.status(404).json({ ok: false, error: 'Not found' });
  const { before, after } = result;
  const actor = cleanText(body.actor, 100) || 'admin';

  const changes = Object.keys(fields)
    .filter((k) => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map((k) => `${k.replace(/_/g, ' ')}: "${before[k] ?? '—'}" → "${after[k] ?? '—'}"`);

  if (changes.length) {
    await addEvent(req.business_id, req.params.id, { event_type: 'note', note: `Lead details updated — ${changes.join('; ')}`, actor });
  }

  res.json({ ok: true, lead: after });
});

/** Deletes a lead outright. lead_events/deals/follow_ups cascade with it. */
adminRouter.delete('/leads/:id', async (req, res) => {
  const deleted = await deleteLead(req.business_id, req.params.id);
  if (!deleted) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, deleted: true });
});

/**
 * Post a freeform update to a lead's activity thread — "called yesterday",
 * "ready to visit the site", whatever the rep actually needs to log. Not
 * tied to a status change (updateStatus already covers that path); this is
 * for the running commentary a sales team keeps on a lead day to day.
 */
adminRouter.post('/leads/:id/notes', async (req, res) => {
  const { note, actor } = req.body || {};
  const cleaned = cleanText(note, 2000);
  if (!cleaned) return res.status(400).json({ ok: false, error: 'note is required', field: 'note' });

  const lead = await getLead(req.business_id, req.params.id);
  if (!lead) return res.status(404).json({ ok: false, error: 'Not found' });

  await addEvent(req.business_id, req.params.id, { event_type: 'note', note: cleaned, actor: cleanText(actor, 100) || 'admin' });
  res.status(201).json({ ok: true, lead: await getLead(req.business_id, req.params.id) });
});

adminRouter.patch('/leads/:id/status', async (req, res) => {
  const { status, note, actor } = req.body || {};
  const allowed = ['pickup', 'closed', 'not_interested'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ ok: false, error: `status must be one of ${allowed.join(', ')}` });
  }
  const lead = await updateStatus(req.business_id, req.params.id, status, { actor: actor || 'admin', note });
  if (!lead) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, lead });
});

adminRouter.get('/report/source', async (req, res) => {
  const rows = await sourceReport(req.business_id, { from: req.query.from, to: req.query.to });
  res.json({ ok: true, rows });
});

/** Reconciliation view: what came in, what we kept, and why we dropped things. */
adminRouter.get('/report/ingest', blockIfHidden('ingest'), async (req, res) => {
  const r = await raw(
    `SELECT source, outcome, reason, COUNT(*) AS n
       FROM ingest_log
      WHERE business_id = $1 AND created_at > now() - interval '30 days'
      GROUP BY source, outcome, reason
      ORDER BY n DESC`,
    [req.business_id],
  );
  res.json({ ok: true, rows: r.rows });
});

adminRouter.get('/export.csv', async (req, res) => {
  const rows = await listLeads(req.business_id, {
    from: req.query.from, to: req.query.to, source: req.query.source, limit: 10_000,
  });
  const cols = [
    'created_at', 'source', 'campaign_name', 'adset_name', 'ad_name',
    'full_name', 'phone_e164', 'email', 'budget_range', 'timeline',
    'status', 'utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'landing_page',
  ];
  const esc = (v) => {
    if (v == null) return '';
    // Dates must not go out as JS toString ("Fri Jul 31 2026 ... (India Standard
    // Time)") — Excel and Sheets won't parse that. ISO 8601 sorts and imports.
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Guard against CSV formula injection — Excel will execute =, +, -, @.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="core-value-realty-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + csv);
});

/**
 * Settings.
 *
 * Only a small, deliberate set of keys are editable from here — company_name
 * (shown in the sidebar) and dedupe_window_days (how many days a repeat
 * phone number counts as the same lead). Nothing secret ever lives in
 * app_settings; API keys and tokens stay in .env, edited on the server.
 */
const EDITABLE_SETTINGS = ['company_name', 'dedupe_window_days'];

// Left open even when 'settings' is hidden — the sidebar's company-name
// branding (App.jsx loadMeta) reads this on every page, not just Settings.
adminRouter.get('/settings', async (req, res) => {
  res.json({ ok: true, settings: await listSettings(req.business_id) });
});

adminRouter.patch('/settings', blockIfHidden('settings'), async (req, res) => {
  const body = req.body || {};
  const updates = Object.keys(body).filter((k) => EDITABLE_SETTINGS.includes(k));
  if (!updates.length) {
    return res.status(400).json({ ok: false, error: `No editable settings in request. Allowed: ${EDITABLE_SETTINGS.join(', ')}` });
  }
  if ('dedupe_window_days' in body) {
    const n = Number(body.dedupe_window_days);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ ok: false, error: 'dedupe_window_days must be a positive number', field: 'dedupe_window_days' });
    }
  }
  if ('company_name' in body && !cleanText(body.company_name)) {
    return res.status(400).json({ ok: false, error: 'company_name cannot be blank', field: 'company_name' });
  }
  for (const key of updates) {
    await setSetting(req.business_id, key, body[key]);
  }
  res.json({ ok: true, settings: await listSettings(req.business_id) });
});

/** Which lead sources are wired up (env vars present), and the URLs to paste into each platform. Never exposes secrets. */
adminRouter.get('/integration-status', blockIfHidden('settings'), async (req, res) => {
  res.json({ ok: true, integrations: getIntegrationStatus(req) });
});

/** Row counts across the CRM's core tables, plus which database backend is running. */
adminRouter.get('/data-stats', blockIfHidden('settings'), async (req, res) => {
  res.json({ ok: true, stats: await getDataStats(req.business_id) });
});

/** Deletes only leads flagged is_test (e.g. Google's "Send test data" button). Real leads are untouched. */
adminRouter.post('/data/wipe-test-leads', blockIfHidden('settings'), async (req, res) => {
  const deleted = await wipeTestLeads(req.business_id);
  res.json({ ok: true, deleted });
});

/**
 * Re-run the builder/project directory seed. Guarded on an empty developers
 * table (same guard migrate.js uses on boot) — it will NOT overwrite or
 * duplicate a directory that's already populated, so this is safe to click
 * but only does something the first time. Global, not business-scoped — the
 * developer directory is shared across every business.
 */
adminRouter.post('/data/reseed-developers', blockIfHidden('settings'), async (_req, res) => {
  const result = await seedDeveloperDirectory();
  res.json({ ok: true, ...result });
});

/**
 * Reps — the shared team list that backs "Acting as" in the UI, replacing a
 * free-text box where the same person could show up under three spellings.
 */
adminRouter.get('/reps', async (req, res) => {
  res.json({ ok: true, reps: await listReps(req.business_id, { activeOnly: req.query.active_only === '1' }) });
});

adminRouter.post('/reps', async (req, res) => {
  const name = (req.body || {}).name;
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const rep = await createRep(req.business_id, name);
  res.status(201).json({ ok: true, rep });
});

adminRouter.patch('/reps/:id', async (req, res) => {
  const { name, is_active } = req.body || {};
  const rep = await updateRep(req.business_id, req.params.id, {
    name: name !== undefined ? name : undefined,
    is_active: is_active !== undefined ? is_active : undefined,
  });
  if (!rep) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, rep });
});

/**
 * Lead tags — an editable classification list (Warm/Cold/Junk/Scheduled/…),
 * managed from Settings the same way reps are. Separate from the pipeline
 * `status`: see the PATCH /leads/:id comment above for why.
 */
adminRouter.get('/tags', async (req, res) => {
  res.json({ ok: true, tags: await listTags(req.business_id, { activeOnly: req.query.active_only === '1' }) });
});

adminRouter.post('/tags', async (req, res) => {
  const { name, color } = req.body || {};
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const tag = await createTag(req.business_id, name, color);
  res.status(201).json({ ok: true, tag });
});

adminRouter.patch('/tags/:id', async (req, res) => {
  const { name, color, is_active } = req.body || {};
  const tag = await updateTag(req.business_id, req.params.id, {
    name: name !== undefined ? name : undefined,
    color: color !== undefined ? color : undefined,
    is_active: is_active !== undefined ? is_active : undefined,
  });
  if (!tag) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, tag });
});

/**
 * Lead-capture forms — the "Contact Form 7" equivalent. Public rendering/
 * submission lives in routes/publicForm.js (unauthenticated, mounted at
 * /f/:public_id); these routes are the session-protected management API
 * behind the Forms page.
 */
adminRouter.use('/forms', blockIfHidden('forms'));

adminRouter.get('/forms', async (req, res) => {
  res.json({ ok: true, forms: await listForms(req.business_id) });
});

adminRouter.post('/forms', async (req, res) => {
  const { name, fields, developer_name, actor } = req.body || {};
  if (!cleanText(name)) return res.status(400).json({ ok: false, error: 'name is required' });
  const form = await createForm(req.business_id, {
    name: cleanText(name, 200),
    fields,
    developer_name: developer_name ? cleanText(developer_name, 200) : null,
    created_by: cleanText(actor, 100) || 'admin',
  });
  res.status(201).json({ ok: true, form });
});

adminRouter.patch('/forms/:id', async (req, res) => {
  const { name, fields, developer_name, is_active } = req.body || {};
  const form = await updateForm(req.business_id, req.params.id, {
    name: name !== undefined ? cleanText(name, 200) : undefined,
    fields,
    developer_name: developer_name !== undefined ? (cleanText(developer_name, 200) || null) : undefined,
    is_active,
  });
  if (!form) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, form });
});

/**
 * Renders the exact public-form HTML for an unsaved draft, so the Forms page
 * can offer a "Preview" button while building a form, before it's saved.
 * Never touches the database — nothing here is persisted.
 */
adminRouter.post('/forms/preview', async (req, res) => {
  const { name, fields, developer_name } = req.body || {};
  const html = await renderFormPreview({
    name: cleanText(name, 200),
    fields: sanitizeFields(fields),
    developer_name: developer_name ? cleanText(developer_name, 200) : null,
  });
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

adminRouter.delete('/forms/:id', async (req, res) => {
  const ok = await deleteForm(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});

/**
 * Support tickets — a discrete, assignable, closeable unit of work, distinct
 * from a lead's follow-ups or activity thread. Optionally linked to a lead
 * (lead_id) so a ticket raised about a specific enquiry can be traced back.
 */
adminRouter.get('/tickets', async (req, res) => {
  const { status, priority, department, assignee, lead_id, q, limit } = req.query;
  res.json({ ok: true, tickets: await listTickets(req.business_id, { status, priority, department, assignee, lead_id, q, limit }) });
});

adminRouter.get('/ticket-stats', async (req, res) => {
  res.json({ ok: true, stats: await ticketStats(req.business_id) });
});

adminRouter.get('/tickets/:id', async (req, res) => {
  const ticket = await getTicket(req.business_id, req.params.id);
  if (!ticket) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, ticket });
});

adminRouter.post('/tickets', async (req, res) => {
  const { subject, description, department, priority, lead_id, requester, assignee, actor } = req.body || {};
  if (!cleanText(subject)) return res.status(400).json({ ok: false, error: 'subject is required', field: 'subject' });
  try {
    const ticket = await createTicket(req.business_id, {
      subject: cleanText(subject, 300),
      description: cleanText(description, 4000),
      department,
      priority,
      lead_id: lead_id || null,
      requester: cleanText(requester, 200),
      assignee: cleanText(assignee, 100),
      created_by: cleanText(actor, 100) || 'admin',
    });
    res.status(201).json({ ok: true, ticket });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

adminRouter.patch('/tickets/:id', async (req, res) => {
  const { subject, description, department, priority, status, assignee, requester, note, actor } = req.body || {};
  try {
    const ticket = await updateTicket(req.business_id, req.params.id, {
      subject: subject !== undefined ? cleanText(subject, 300) : undefined,
      description: description !== undefined ? cleanText(description, 4000) : undefined,
      department,
      priority,
      status,
      assignee: assignee !== undefined ? (cleanText(assignee, 100) || null) : undefined,
      requester: requester !== undefined ? (cleanText(requester, 200) || null) : undefined,
      note: cleanText(note, 2000),
      actor: cleanText(actor, 100) || 'admin',
    });
    if (!ticket) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true, ticket });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

adminRouter.delete('/tickets/:id', async (req, res) => {
  const ok = await deleteTicket(req.business_id, req.params.id);
  if (!ok) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true });
});
