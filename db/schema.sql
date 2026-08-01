-- Core Realty CRM — Phase 1 schema
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
