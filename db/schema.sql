-- Core Value Realty — Phase 1 schema
-- Postgres 14+
--
-- CHANGES vs the original spec (deliberate, see SPEC-REVIEW.md):
--   * Attribution columns added. `source` alone (meta/google/website) cannot answer
--     "which campaign produced this lead", which is the entire commercial purpose
--     of the project.
--   * phone_e164 + dedupe_key added. Without normalisation, dedupe is impossible
--     and lead counts will be inflated.
--   * lead_events added. "Complete lifecycle of the lead" was in the brief; a single
--     mutable `status` column loses the history the moment it changes.
--   * ingest_log added. Meta retries webhooks; without idempotency you get dupes.

-- gen_random_uuid() is core Postgres from v13 onward — no pgcrypto needed.

-- ---------------------------------------------------------------------------
-- businesses — one row per client using this CRM. Each business's data
-- (leads, deals, forms, tickets, follow-ups, reps, tags, settings, ingest
-- log) is scoped to it and invisible to every other business — that's the
-- entire point. developers/projects/project_unit_types stay a SHARED
-- read-only catalog across all businesses (public builder/project info, not
-- client-specific), so they deliberately have no business_id.
--
-- Child/detail tables (lead_events, ticket_events, deal_applicants,
-- deal_cost_items, deal_payment_milestones, deal_documents) don't carry
-- their own business_id either — they're always reached through their
-- parent (lead_id/deal_id/ticket_id), which IS scoped, and every query that
-- fetches them must join through that parent rather than trusting a bare id.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  email          TEXT NOT NULL,
  password_hash  TEXT,             -- NULL until a password is set via scripts/create-business.js
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS businesses_email_uniq ON businesses (LOWER(email));

-- URL-friendly identifier so a client can be handed their own login link,
-- e.g. findmigo.com/core-value-realty — purely a vanity/branding path, NOT
-- the auth boundary (that's still email+password → business_id from the
-- session token). Nullable + partial unique index so older rows without one
-- yet don't collide with each other on NULL = NULL.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS businesses_slug_uniq ON businesses (slug) WHERE slug IS NOT NULL;

-- Per-client feature restriction: page keys (matching client/src/constants.js
-- NAV keys — 'settings', 'forms', 'ingest', etc.) that this business should
-- NOT see or be able to reach, neither in the sidebar nor via the API. Empty
-- array (the default) means full, unrestricted access — every business today
-- keeps behaving exactly as before until this is explicitly set via
-- scripts/set-hidden-pages.js.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS hidden_pages TEXT[] NOT NULL DEFAULT '{}';

-- A business can be reached by more than one login (owner + a colleague, or
-- two email addresses for the same team) — every row here is a full set of
-- credentials, but they all resolve to the SAME business_id, so whoever logs
-- in with any of them sees the exact same leads/data. The original single
-- email+password on `businesses` still works untouched (kept for backward
-- compatibility and as the "primary" contact); this table is only consulted
-- for logins that were added on top of it via scripts/add-login.js.
CREATE TABLE IF NOT EXISTS business_logins (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id    UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same idea as businesses.hidden_pages, but scoped to just THIS login rather
-- than the whole business — so one added login (e.g. a client's own view
-- into a business that's actually owned/run by someone else) can be
-- restricted without touching the business's own primary login, which
-- shares the same underlying data. The two lists are unioned at request
-- time (see getEffectiveHiddenPages in src/auth.js): whatever's hidden for
-- the business is hidden for every login too; this just adds more on top
-- for one specific login.
ALTER TABLE business_logins ADD COLUMN IF NOT EXISTS hidden_pages TEXT[] NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX IF NOT EXISTS business_logins_email_uniq ON business_logins (LOWER(email));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  location        TEXT,
  price_range     TEXT,
  inventory_notes TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- developers — builder directory. Backs manual lead entry: when a Meta lead
-- is downloaded from Ads Manager and re-typed by hand, or a walk-in/phone
-- lead is logged manually, it still needs to carry a real developer + project
-- so it can be reported on — not free text nobody can group later.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS developers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  grade       TEXT CHECK (grade IN ('A', 'B')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS developers_name_uniq ON developers (LOWER(name));

-- projects gains a developer link. ADD COLUMN IF NOT EXISTS, not a rewritten
-- CREATE TABLE — this table already exists in any database that ran Phase 1's
-- migrate before this change, and CREATE TABLE IF NOT EXISTS above is a
-- no-op against an existing table, so it would never retrofit the column.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS developer_id UUID REFERENCES developers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS projects_developer_idx ON projects (developer_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_name_developer_uniq ON projects (LOWER(name), developer_id);

-- projects gains a broad locality grouping ("area", e.g. "Sarjapur") distinct
-- from the specific free-text `location`, and a possession date/estimate —
-- both came out of importing a real project-catalog spreadsheet that had no
-- equivalent columns to reuse. Text, not DATE: source possession values arrive
-- as a bare year, "Sept 2030", or a full date depending on who filled the row,
-- and forcing that into a strict date type would lose or mangle the ones that
-- aren't a clean date.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS area TEXT;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS possession TEXT;
CREATE INDEX IF NOT EXISTS projects_area_idx ON projects (area);

-- ---------------------------------------------------------------------------
-- project_unit_types — a project isn't one price, it's a handful of unit
-- configurations (1BHK/2BHK/3BHK/...), each with its own size and price
-- range. One row per configuration, not a delimited string on `projects`, so
-- the CRM can actually list "what sizes does this project have" instead of
-- parsing free text.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS project_unit_types (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  configuration TEXT,        -- e.g. '1BHK', '3BHK + 2T'
  dimension     TEXT,        -- e.g. '458sqft', '1085-1093sqft'
  price_range   TEXT,        -- e.g. '71lakh-76lakh', 'Rs. 1.67 Crore to Rs. 1.73 Crore Onwards'
  sort_order    INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_unit_types_project_idx ON project_unit_types (project_id);

-- ---------------------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE lead_source AS ENUM ('meta', 'google', 'website');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE lead_status AS ENUM (
    'new', 'contacted', 'site_visit', 'negotiation', 'closed', 'dropped'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- leads
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leads (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ---- core identity -----------------------------------------------------
  full_name     TEXT,
  phone_raw     TEXT NOT NULL,
  phone_e164    TEXT NOT NULL,          -- normalised, e.g. +919876543210
  email         TEXT,
  budget_range  TEXT,
  timeline      TEXT,
  project_id    UUID REFERENCES projects(id) ON DELETE SET NULL,

  -- ---- source & attribution ---------------------------------------------
  -- `source` is the channel bucket. Everything below it is what actually
  -- lets you prove performance to the client at campaign level.
  source            lead_source NOT NULL,
  platform_lead_id  TEXT,        -- Meta leadgen_id / Google lead_id. Idempotency anchor.

  campaign_id       TEXT,
  campaign_name     TEXT,
  adset_id          TEXT,        -- Meta ad set / Google ad group
  adset_name        TEXT,
  ad_id             TEXT,
  ad_name           TEXT,
  form_id           TEXT,
  form_name         TEXT,

  -- website / click-level identifiers
  utm_source        TEXT,
  utm_medium        TEXT,
  utm_campaign      TEXT,
  utm_content       TEXT,
  utm_term          TEXT,
  gclid             TEXT,
  wbraid            TEXT,
  gbraid            TEXT,
  fbclid            TEXT,
  msclkid           TEXT,

  landing_page      TEXT,
  referrer          TEXT,
  -- first-touch snapshot, captured by tracker.js on the visitor's first ever
  -- session and carried forward. Lets you report first-touch AND last-touch.
  first_touch       JSONB,

  -- ---- lifecycle ---------------------------------------------------------
  status        lead_status NOT NULL DEFAULT 'new',
  owner_name    TEXT,                   -- Phase 2 will replace with users FK
  is_duplicate  BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of  UUID REFERENCES leads(id) ON DELETE SET NULL,
  is_test       BOOLEAN NOT NULL DEFAULT FALSE,

  -- ---- audit -------------------------------------------------------------
  raw_payload   JSONB NOT NULL DEFAULT '{}'::jsonb,
  submitted_at  TIMESTAMPTZ,            -- time reported by the source platform
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per platform lead. Makes Meta/Google webhook retries harmless.
CREATE UNIQUE INDEX IF NOT EXISTS leads_platform_lead_id_uniq
  ON leads (source, platform_lead_id)
  WHERE platform_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS leads_phone_idx      ON leads (phone_e164);
CREATE INDEX IF NOT EXISTS leads_source_idx     ON leads (source);
CREATE INDEX IF NOT EXISTS leads_status_idx     ON leads (status);
CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_campaign_idx   ON leads (campaign_id);

-- ---- manual entry support ---------------------------------------------
-- Same pattern as campaign_id/campaign_name elsewhere in this table: snapshot
-- the developer/project name at submission time so a later rename in the
-- `projects` table doesn't silently rewrite what a past lead said.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS developer_name TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_name   TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS entry_method    TEXT NOT NULL DEFAULT 'automatic';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS created_by      TEXT;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_entry_method_chk CHECK (entry_method IN ('automatic', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leads_entry_method_idx ON leads (entry_method);

-- ---- structured budget, for pipeline value / forecast reporting -------
-- budget_range stays as free text ("1.5-2 Cr", "under 50L") because that's
-- how leads actually arrive and how the team talks. These are additive,
-- numeric-only fields (₹ lakhs) so the dashboard can sum a real pipeline
-- value instead of trying to parse "2-3 Cr+" at query time.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget_min NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS budget_max NUMERIC;

-- ---- tenant scope -------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS leads_business_idx ON leads (business_id);
-- The Meta/Google webhook idempotency guarantee is per-business now, not
-- global — two different clients each running their own Meta ad account can
-- coincidentally get the same leadgen_id from Meta's side without colliding.
DROP INDEX IF EXISTS leads_platform_lead_id_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS leads_platform_lead_id_uniq
  ON leads (business_id, source, platform_lead_id)
  WHERE platform_lead_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- lead_events — the lifecycle audit trail
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_events (
  id          BIGSERIAL PRIMARY KEY,
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,        -- created | status_change | note | assigned
  from_status lead_status,
  to_status   lead_status,
  note        TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_events_lead_idx ON lead_events (lead_id, created_at);

-- ---------------------------------------------------------------------------
-- deals — a real record, distinct from a lead. A lead is "someone interested";
-- a deal is "we are actually negotiating a specific unit with them", which is
-- why it only gets created once a lead reaches negotiation, and carries fields
-- a lead never has: which unit, the agreed price, and an expected close date.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deals (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id                UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  developer_name         TEXT,
  project_name           TEXT,
  unit_number            TEXT,
  agreed_price           NUMERIC,      -- ₹ lakhs, same convention as leads.budget_min/max
  expected_closing_date  DATE,
  stage                  TEXT NOT NULL DEFAULT 'negotiation',
  notes                  TEXT,
  created_by             TEXT,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE deals ADD CONSTRAINT deals_stage_chk
    CHECK (stage IN ('negotiation', 'booked', 'closed_won', 'closed_lost'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS deals_lead_idx  ON deals (lead_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals (stage);

ALTER TABLE deals ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS deals_business_idx ON deals (business_id);

-- ---------------------------------------------------------------------------
-- follow_ups — "call this lead back on X" reminders. Nothing like this
-- existed before; it's the backing table for the dashboard's upcoming
-- follow-ups widget and for reminders inside a lead's detail view.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS follow_ups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_at       TIMESTAMPTZ NOT NULL,
  note         TEXT,
  assigned_to  TEXT,
  is_done      BOOLEAN NOT NULL DEFAULT FALSE,
  done_at      TIMESTAMPTZ,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS follow_ups_due_idx  ON follow_ups (due_at) WHERE is_done = FALSE;
CREATE INDEX IF NOT EXISTS follow_ups_lead_idx ON follow_ups (lead_id);

ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS follow_ups_business_idx ON follow_ups (business_id);

-- ---------------------------------------------------------------------------
-- app_settings — small key/value store for things that were previously only
-- changeable by editing .env and restarting (dedupe window, display name).
-- Deliberately NOT for secrets — those stay in .env, never in the database
-- or an API response the admin UI can read back.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- business_id is added here, but the PRIMARY KEY isn't switched to the
-- composite (business_id, key) until migrate.js's JS-side backfill step —
-- that needs every existing row's business_id filled in first (a bare
-- PRIMARY KEY can't be added over NULLs), and the default business doesn't
-- exist yet at the point this plain-SQL file runs. See migrate.js.
ALTER TABLE app_settings ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);

-- ---------------------------------------------------------------------------
-- reps — the managed team-member list. Replaces free-typed "Acting as" text
-- so the leaderboard and activity feed group by one canonical name per
-- person instead of splitting "Arjun" / "arjun" / "Arjun " into three.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE reps ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS reps_business_idx ON reps (business_id);
-- Two different businesses can each have a rep named "Arjun" — uniqueness is
-- per business now, not global.
DROP INDEX IF EXISTS reps_name_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS reps_name_uniq ON reps (business_id, LOWER(name));

-- ---------------------------------------------------------------------------
-- ingest_log — every inbound hit, accepted or not
-- This is your evidence file. When the client says "Meta reports 300 and you
-- show 274", you open this table instead of guessing.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingest_log (
  id           BIGSERIAL PRIMARY KEY,
  source       TEXT NOT NULL,
  outcome      TEXT NOT NULL,       -- accepted | duplicate | rejected | error
  reason       TEXT,
  lead_id      UUID REFERENCES leads(id) ON DELETE SET NULL,
  http_status  INT,
  payload      JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingest_log_created_idx ON ingest_log (created_at DESC);
CREATE INDEX IF NOT EXISTS ingest_log_outcome_idx ON ingest_log (outcome);

ALTER TABLE ingest_log ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS ingest_log_business_idx ON ingest_log (business_id);

-- ---------------------------------------------------------------------------
-- lead_tags — a managed, editable label ("Warm", "Cold", "Junk", "Scheduled",
-- and whatever else the team wants to add later from Settings) that sits
-- ALONGSIDE the pipeline `status` column, not instead of it. `status` still
-- drives the dashboard funnel and deal-creation eligibility; a tag is just an
-- informational classification a rep can set independently — a lead can be
-- "new" and "warm" at the same time, or "contacted" and "junk".
--
-- Same snapshot convention as developer_name/project_name elsewhere: leads.tag
-- is plain TEXT, not a live foreign key, so renaming or deactivating a tag in
-- Settings never silently rewrites what a past lead was actually marked as.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT 'gray',   -- one of the preset keys in styles.css (.tag-*)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE lead_tags ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS lead_tags_business_idx ON lead_tags (business_id);
DROP INDEX IF EXISTS lead_tags_name_uniq;
CREATE UNIQUE INDEX IF NOT EXISTS lead_tags_name_uniq ON lead_tags (business_id, LOWER(name));

ALTER TABLE leads ADD COLUMN IF NOT EXISTS tag TEXT;
CREATE INDEX IF NOT EXISTS leads_tag_idx ON leads (tag);

-- ---------------------------------------------------------------------------
-- lead_forms — self-service "Contact Form 7"-style lead capture forms. An
-- admin builds one from Settings, gets back a public_id, and embeds
-- /f/:public_id in an <iframe> on the WordPress site. Submissions land
-- directly as `leads` rows (source = 'website') with NO shared secret
-- involved — the form is served BY this app, so the browser posts back to
-- the same origin the iframe loaded from, sidestepping the HMAC-signed
-- /api/leads/website path entirely (that one's for a server-to-server
-- integration; this one's for a plain embed a non-developer can paste in).
--
-- Which form a lead came through is recorded on the existing generic
-- leads.form_id/form_name columns (already used by Meta/Google for their own
-- lead-form identifiers) rather than a new column — same meaning, different
-- channel.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lead_forms (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      TEXT NOT NULL,           -- short random token used in the embed URL
  name           TEXT NOT NULL,           -- internal label, e.g. "Homepage contact form"
  show_email     BOOLEAN NOT NULL DEFAULT TRUE,   -- superseded by `fields` below, kept for old rows
  show_budget    BOOLEAN NOT NULL DEFAULT TRUE,
  show_project   BOOLEAN NOT NULL DEFAULT TRUE,
  show_message   BOOLEAN NOT NULL DEFAULT TRUE,
  developer_name TEXT,                    -- optional: pin the project dropdown to one developer
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_by     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS lead_forms_public_id_uniq ON lead_forms (public_id);

-- public_id stays a single GLOBAL namespace on purpose — /f/:public_id is one
-- shared public URL space, not scoped per business, and an 8-char random
-- token colliding across two different businesses is astronomically unlikely.
-- business_id is what tells a submission through that form which business's
-- leads table it belongs to.
ALTER TABLE lead_forms ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS lead_forms_business_idx ON lead_forms (business_id);

-- Freeform, admin-editable field list — first name / last name / email /
-- budget / which-project / message by default, but any of them can be
-- deleted and arbitrary custom text fields added, straight from the Forms
-- page's field builder. Ordered array of {key, label, type, required}.
-- Phone number is NOT in here — it's always collected, hardcoded in the
-- public form template, because leads.phone_e164 is NOT NULL and every
-- dedupe/report query in this app keys off it.
ALTER TABLE lead_forms ADD COLUMN IF NOT EXISTS fields JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- tickets — internal support tickets (a client-facing issue, an internal
-- request to accounts/documentation, a site-visit coordination problem…).
-- Distinct from `follow_ups` (a simple reminder on one lead) and from the
-- lead activity thread (a running log) — a ticket is a discrete, assignable,
-- closeable unit of work, optionally linked back to the lead it's about.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tickets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject      TEXT NOT NULL,
  description  TEXT,
  department   TEXT NOT NULL DEFAULT 'general',
  priority     TEXT NOT NULL DEFAULT 'medium',
  status       TEXT NOT NULL DEFAULT 'open',
  lead_id      UUID REFERENCES leads(id) ON DELETE SET NULL,
  requester    TEXT,
  assignee     TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at  TIMESTAMPTZ
);
DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_department_chk
    CHECK (department IN ('general', 'sales', 'payments', 'documentation', 'site_visit'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_priority_chk
    CHECK (priority IN ('low', 'medium', 'high', 'urgent'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE tickets ADD CONSTRAINT tickets_status_chk
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS tickets_status_idx    ON tickets (status);
CREATE INDEX IF NOT EXISTS tickets_priority_idx  ON tickets (priority);
CREATE INDEX IF NOT EXISTS tickets_assignee_idx  ON tickets (assignee);
CREATE INDEX IF NOT EXISTS tickets_lead_idx      ON tickets (lead_id);
CREATE INDEX IF NOT EXISTS tickets_created_idx   ON tickets (created_at DESC);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS business_id UUID REFERENCES businesses(id);
CREATE INDEX IF NOT EXISTS tickets_business_idx ON tickets (business_id);

-- Same audit-trail pattern as lead_events — a status change or a note leaves
-- a permanent trace instead of silently overwriting the ticket row.
CREATE TABLE IF NOT EXISTS ticket_events (
  id          BIGSERIAL PRIMARY KEY,
  ticket_id   UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,        -- created | status_change | note | assigned
  from_status TEXT,
  to_status   TEXT,
  note        TEXT,
  actor       TEXT NOT NULL DEFAULT 'system',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ticket_events_ticket_idx ON ticket_events (ticket_id, created_at);

-- ---------------------------------------------------------------------------
-- Bookings & payment tracking — extends `deals` (a deal IS a booking once it
-- reaches the "booked" stage) with the paperwork a real booking generates:
-- who's on the application, what the total cost breaks down to, the payment
-- schedule against it, and a document checklist. No file-storage infra exists
-- yet, so deal_documents tracks STATUS + a text reference (e.g. "original
-- with reception", "scanned copy emailed 12 Aug"), not an actual upload.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deal_applicants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  full_name   TEXT NOT NULL,
  relation    TEXT NOT NULL DEFAULT 'primary',   -- primary | co_applicant
  phone       TEXT,
  email       TEXT,
  pan         TEXT,
  aadhaar     TEXT,
  address     TEXT,
  notes       TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE deal_applicants ADD CONSTRAINT deal_applicants_relation_chk
    CHECK (relation IN ('primary', 'co_applicant'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS deal_applicants_deal_idx ON deal_applicants (deal_id);

CREATE TABLE IF NOT EXISTS deal_cost_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,          -- e.g. "Base price", "GST", "Registration", "Club membership"
  amount      NUMERIC NOT NULL DEFAULT 0,   -- ₹ lakhs, same convention as deals.agreed_price
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS deal_cost_items_deal_idx ON deal_cost_items (deal_id);

CREATE TABLE IF NOT EXISTS deal_payment_milestones (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id      UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  label        TEXT NOT NULL,         -- e.g. "Booking amount", "On agreement", "On possession"
  due_date     DATE,
  amount       NUMERIC NOT NULL DEFAULT 0,
  paid_amount  NUMERIC NOT NULL DEFAULT 0,
  paid_date    DATE,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | overdue
  notes        TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE deal_payment_milestones ADD CONSTRAINT deal_payment_milestones_status_chk
    CHECK (status IN ('pending', 'paid', 'overdue'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS deal_payment_milestones_deal_idx ON deal_payment_milestones (deal_id);

CREATE TABLE IF NOT EXISTS deal_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,          -- e.g. "PAN card", "Sale agreement", "Loan sanction letter"
  status      TEXT NOT NULL DEFAULT 'pending',   -- pending | received | verified
  reference   TEXT,                   -- free text: where the physical/scanned copy actually is
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE deal_documents ADD CONSTRAINT deal_documents_status_chk
    CHECK (status IN ('pending', 'received', 'verified'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS deal_documents_deal_idx ON deal_documents (deal_id);

-- ---------------------------------------------------------------------------
-- leads.viewed_at — NULL until someone opens the lead's detail drawer once
-- (set the moment getLead() is called, see src/leads.js). Drives the
-- "unread"-style bold row in the Leads table for any lead nobody has looked
-- at yet, same idea as an inbox: bold until opened, then stays normal weight
-- forever after, even if it's re-opened later.
-- ---------------------------------------------------------------------------
ALTER TABLE leads ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS leads_viewed_idx ON leads (viewed_at);

-- ---------------------------------------------------------------------------
-- leads.status simplified from 6 stages (new/contacted/site_visit/
-- negotiation/closed/dropped) down to 3: pickup, closed, not_interested.
-- Switched from a native enum to plain TEXT + CHECK (same pattern already
-- used for tickets.status/deals.stage below) because Postgres enums can only
-- ever gain values, never lose or rename them — TEXT + CHECK can be
-- redefined freely if the stage list changes again later. lead_events'
-- from_status/to_status (the audit trail) get the same type change so old
-- history keeps rendering, but are left unconstrained on purpose — a past
-- event genuinely said "site_visit" and should keep saying that forever,
-- not get rewritten to fit the current stage list.
--
-- Wrapped in a data_type check so the (one-time, table-rewriting) TYPE
-- conversion and value remap only ever run once, not on every cold start's
-- migrate() call — after the first run the column is already TEXT and this
-- whole block is skipped.
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name = 'leads' AND column_name = 'status') <> 'text' THEN
    ALTER TABLE leads ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE leads ALTER COLUMN status TYPE TEXT USING status::text;
    ALTER TABLE leads ALTER COLUMN status SET DEFAULT 'pickup';

    UPDATE leads SET status = CASE
      WHEN status IN ('new', 'contacted', 'site_visit', 'negotiation') THEN 'pickup'
      WHEN status = 'dropped' THEN 'not_interested'
      ELSE status  -- 'closed' stays 'closed'
    END;
  END IF;

  IF (SELECT data_type FROM information_schema.columns
       WHERE table_name = 'lead_events' AND column_name = 'from_status') <> 'text' THEN
    ALTER TABLE lead_events ALTER COLUMN from_status TYPE TEXT USING from_status::text;
    ALTER TABLE lead_events ALTER COLUMN to_status TYPE TEXT USING to_status::text;
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE leads ADD CONSTRAINT leads_status_chk
    CHECK (status IN ('pickup', 'closed', 'not_interested'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_touch_updated_at ON leads;
CREATE TRIGGER leads_touch_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS deals_touch_updated_at ON deals;
CREATE TRIGGER deals_touch_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS tickets_touch_updated_at ON tickets;
CREATE TRIGGER tickets_touch_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS deal_payment_milestones_touch_updated_at ON deal_payment_milestones;
CREATE TRIGGER deal_payment_milestones_touch_updated_at
  BEFORE UPDATE ON deal_payment_milestones
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS deal_documents_touch_updated_at ON deal_documents;
CREATE TRIGGER deal_documents_touch_updated_at
  BEFORE UPDATE ON deal_documents
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
