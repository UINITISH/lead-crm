# Core Value Realty — Phase 1

Multi-source lead capture with campaign-level attribution.
Node 20+ · Express · PostgreSQL · React (Vite build, `client/`)

**Read `SPEC-REVIEW.md` first.** It explains six deliberate departures from the
original build spec and why each one would have cost you the client.

---

## Run it in 60 seconds

```bash
npm install                 # also installs client/ dependencies (postinstall)
cp .env.example .env        # leave DATABASE_URL blank to use PGlite locally
npm run build                # compiles client/ -> public/ (do this once, and again after any frontend change)
npm start                    # -> http://localhost:3400
```

Leave `DATABASE_URL` empty and it runs on **PGlite** — real Postgres compiled to
WASM, no server to install. Set `DATABASE_URL` and it's ordinary Postgres. Same
SQL both ways, so local dev can't drift from production.

Verify everything against the acceptance criteria:

```bash
npm run test:e2e     # 36 checks, no ad accounts or Postgres required
```

### Frontend development

The UI lives in `client/` (React + Vite) and builds into `public/`, which
`src/server.js` serves as static files — nothing to configure. Day to day:

- Made a frontend change and just want to see it? `npm run build`, then
  refresh the browser. No server restart needed.
- Want live hot-reload while actively editing UI code? `npm run dev` runs the
  Express API and the Vite dev server together (`http://localhost:5173`,
  proxying `/api` to the backend on `3400`).
- `npm start` alone always serves whatever was last built into `public/` — it
  does not rebuild automatically.

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/leads/website` | Website form. HMAC-signed. |
| GET | `/api/leads/meta/webhook` | Meta subscription handshake. |
| POST | `/api/leads/meta/webhook` | Meta leadgen event. |
| POST | `/api/leads/google/webhook` | Google Ads lead form. Native, no Zapier. |
| GET | `/api/admin/leads` | List, with filters. |
| GET | `/api/admin/leads/:id` | Detail + lifecycle trail. |
| PATCH | `/api/admin/leads/:id/status` | Move through the pipeline. |
| GET | `/api/admin/report/source` | Leads by source and campaign. |
| GET | `/api/admin/report/ingest` | Reconciliation: what was rejected and why. |
| GET | `/api/admin/export.csv` | Full export with attribution columns. |
| GET | `/healthz` | Uptime monitoring. Point a monitor at this. |

---

## Build order (matches the spec, with the review's corrections)

### Week 1 — deploy first, build second

Do this before writing feature code. Meta's review depends on it.

1. Provision the VPS, Postgres, nginx, and a real HTTPS cert on
   `crm.corerealty.example`. Let's Encrypt is fine.
2. Deploy this repo. Confirm `GET /healthz` returns 200 over HTTPS from outside.
3. Confirm `GET /api/leads/meta/webhook?hub.mode=subscribe&hub.verify_token=<yours>&hub.challenge=1`
   returns `1`. **Meta's reviewers hit this exact URL.** A 404 here is a
   rejection and a reset clock.
4. Submit the Meta app for `leads_retrieval`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_ads`, `ads_management`. Day 1. This is
   the non-dev person's job and it is the critical path.

### Week 1–2 — website form

1. Generate a secret: `openssl rand -hex 32` → `WEBSITE_INGEST_SECRET`.
2. Put the same value in the Next.js site's env.
3. Copy `examples/nextjs-form-handler.js` into the site as `app/api/lead/route.js`.
4. Add `tracker.js` to the site layout, loaded on **every** page:
   ```jsx
   <Script src="https://crm.corerealty.example/tracker.js" strategy="afterInteractive" />
   ```
   This is what makes website leads attributable. Without it every site lead
   reads "direct" and the Meta/Google spend that produced it gets no credit.
5. Submit a test lead. It should appear in the UI within a second, carrying
   whatever UTMs were on the landing URL.

### Week 2–3 — Google Ads

1. Generate a key: `openssl rand -hex 24` → `GOOGLE_WEBHOOK_KEY`.
2. In Google Ads → the lead form asset → **Webhook integration**:
   - Webhook URL: `https://crm.corerealty.example/api/leads/google/webhook`
   - Webhook key: the value above
3. Hit **Send test data**. It arrives flagged `is_test` and stays out of reports.
4. No Zapier. No Make. No monthly fee.

### Week 3–4 — Meta (blocked on app review)

Once Advanced Access is granted:

1. Generate a long-lived Page access token.
2. Subscribe the Page to `leadgen`:
   ```bash
   curl -X POST "https://graph.facebook.com/v21.0/<PAGE_ID>/subscribed_apps" \
     -d "subscribed_fields=leadgen" \
     -d "access_token=<PAGE_TOKEN>"
   ```
3. Use Meta's Lead Ads Testing Tool to fire a test lead.
4. Confirm campaign / ad set / ad names land on the row — not just `source=meta`.

### Week 4–5 — UAT and handover

Run the acceptance checklist below against live ad accounts, then hand over.

---

## Acceptance criteria — all covered by `npm run test:e2e`

Your original list, plus what the review added:

- [x] Website submission lands in `leads` within seconds
- [x] Meta submission lands via webhook (idempotent under retry)
- [x] Google submission lands via native webhook
- [x] Every lead shows its `source`
- [x] UI lists source, name, phone, status, created date
- [x] `raw_payload` stored for every lead
- [x] **Campaign / ad set / ad captured for every paid lead**
- [x] **Phones normalised; repeat submissions flagged as duplicates**
- [x] **Unsigned, bot, and malformed submissions rejected and logged**
- [x] **Every status change recorded with actor and timestamp**
- [x] **Source × campaign report and CSV export available**
- [x] **Rejections queryable for reconciliation against platform-reported counts**

---

## Explaining the numbers to Core Value Realty

You will be asked why Meta reports 300 and the CRM shows 274. Settle this in
writing **before** the first report, not during it.

Put this in the reporting doc:

> Leads are attributed on a **last non-direct click** basis. Platform-reported
> figures (Meta Ads Manager, Google Ads) will differ from CRM figures because
> platforms count form opens and modelled conversions, deduplicate differently,
> and attribute across devices. **The CRM is the source of truth for billing and
> delivery.** Duplicate submissions from the same phone number within 30 days
> count once.

Then, when questioned, open `GET /api/admin/report/ingest` and show the actual
rejections — invalid numbers, bot submissions, test data. That's a five-minute
conversation instead of a lost account.

---

## Before this touches real leads

- [ ] `openssl rand -hex 32` for every secret. No defaults left in `.env`.
- [ ] HTTPS only. Redirect port 80.
- [ ] Nightly `pg_dump` to off-server storage — **and one tested restore**.
- [ ] An uptime monitor on `/healthz` that pages a human.
- [ ] `.env` in `.gitignore`. Confirm it isn't already in git history.
- [ ] Data processing clause added to the Core Value Realty retainer (DPDP Act 2023).
- [ ] Core Value Realty's privacy policy mentions advertising measurement cookies.

---

## Phase 2 — do these in this order

1. ~~**Real user accounts.**~~ Done — one login (email + password) per client
   business, isolating each business's data from every other's. Still not
   per-staff-member accounts within a business (everyone at a client shares
   that one login), which is an intentional simplification, not an oversight.
2. **Assignment engine** — round-robin or by project.
3. **WhatsApp Business API.** Note: click-to-WhatsApp ads pass a `ctwa_clid`
   parameter that ties the conversation back to the ad. Capture it or WhatsApp
   leads become another unattributable bucket.
4. **Call tracking numbers.** Phone leads are currently invisible. A pool of
   tracked numbers per campaign is the only way to attribute them.
5. **Offline conversion upload** back to Meta and Google. Once the CRM knows
   which leads became site visits and sales, feeding that back materially
   improves the platforms' optimisation. This is the highest-leverage item on
   the list and almost nobody does it.
