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
CREATE UNIQUE INDEX IF NOT EXISTS reps_name_uniq ON reps (LOWER(name));

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
