# Spec review — Core Value Realty Phase 1

Read this before you brief the devs. The build is done and passing, but six
things in the spec would have cost you the client relationship if shipped as
written.

---

## 1. BLOCKER — the schema cannot answer the question the project exists to answer

Your spec has one attribution field:

```
source | enum | meta, google, website
```

Your stated business reason for the project: *"the client wants to know this
because if we are not giving this, it'll be a loss for us, it won't be
considered from our side."*

`source = 'meta'` does not prove anything. The client already knows they run
Meta ads. What they need — and what determines whether your work "counts" — is
**which campaign, which ad set, which creative** produced each lead, so cost per
lead can be computed per campaign and compared against the money they gave you.

A client asking "which of my ads is working" cannot be answered by a column that
only says "Facebook."

**Fixed.** The schema now carries `campaign_id/name`, `adset_id/name`,
`ad_id/name`, `form_id`, all `utm_*`, `gclid`, `wbraid`, `gbraid`, `fbclid`,
`landing_page`, `referrer`, and a `first_touch` snapshot. Meta's Graph API and
Google's webhook both return this hierarchy — it costs nothing extra to store,
and it's impossible to backfill once the leads are already in.

## 2. BLOCKER — no deduplication, and no way to add it later

Nothing in the spec normalises phone numbers. In Indian real estate the same
buyer submits three times across two campaigns within a week. Meta sends
`+91 98765 43210`, Google sends `+919876543210`, the website sends
`9876543210`. Three rows, one buyer.

You will report 340 leads. The client's sales team will say they only spoke to
about 250 people. You will have no way to explain the gap, and every number you
present after that is suspect.

**Fixed.** `phone_e164` normalisation on every path, plus a rolling 30-day
dedupe window. Duplicates are stored and linked, not deleted — so you can show
both the gross and the honest number, and explain the difference on demand.

## 3. BLOCKER — the website endpoint has no authentication

`POST /api/leads/website` as specified accepts anything from anyone. A public,
unauthenticated lead endpoint gets found and stuffed. Once the client sees
obvious junk in their CRM, they stop trusting the real leads too.

**Fixed.** HMAC-SHA256 signature (signed server-side in Next.js so the secret
never enters the browser bundle), a honeypot field, and a rate limit.

## 4. Google Ads does NOT need Zapier — delete that line item

The spec allocates 2–3 days plus an ongoing Zapier/Make subscription for the
Google bridge. Google Ads lead form assets have **native webhook delivery**
built in: you paste a Webhook URL and a Webhook Key into the lead form asset,
Google POSTs each submission directly, and echoes the key back as `google_key`
so you can authenticate it.

Removing the bridge removes a monthly cost, a third party holding your client's
PII, and a failure mode you can't debug when it silently stops firing.

**Fixed.** Native endpoint built and tested. Save the 2–3 days.

## 5. The timeline assumption is doing far too much work

The spec says *"~3 weeks, assuming Meta app review doesn't stall the timeline."*

Meta's `leads_retrieval` requires Advanced Access via App Review, and reviewers
**actively test your live webhook endpoint during review** — a timeout, a 404,
or a failed verification handshake is an immediate rejection that resets the
clock. You also generally need a verified business behind the app.

Realistic range: 1–3 weeks for review alone, and it does not reliably run in
parallel because reviewers need the endpoint publicly live on HTTPS first.

**Plan for 4–5 weeks end to end.** Two things follow:

- Get the Meta webhook endpoint deployed on a real HTTPS domain in **week 1**,
  before anything else. Submit for review the same day.
- Tell Core Value Realty 4–5 weeks now. Promising 3 and delivering in 5 costs you more
  credibility than promising 5 and delivering in 4.

## 6. "Owner dashboard / analytics — out of scope" contradicts the objective

You wrote that the project exists to prove lead delivery to the client, then
deferred every reporting surface to Phase 2. If Phase 1 ships as specified, you
have leads in a database and still nothing to put in front of Core Value Realty.

**Fixed, cheaply.** A source/campaign breakdown and a CSV export are included.
That's a few hours of work, not a phase. Full analytics can still wait.

---

## Two more things, smaller but real

**Meta retries.** Meta re-delivers on any non-2xx response. The spec's flow
(webhook → Graph API call → insert) will duplicate leads whenever the Graph call
is slow. The build now ACKs with 200 immediately and processes asynchronously,
with a unique index on `(source, platform_lead_id)` as the backstop.

**Test data pollutes reports.** Google's "Send test data" button sets
`is_test: true`. Store those rows but flag them, or your first client report
includes your own QA submissions.

---

## What I'd still push back on

**You chose to build and host this yourself, maintained by your team inside the
retainer.** That's a defensible choice — it's a billable asset and you control
it. Go in with eyes open about what you just signed up for:

- Uptime. If the VPS goes down at 11pm on a Saturday, leads are lost
  permanently. Meta retries for a limited window; Google does too. Neither
  retries forever. You need monitoring on `/healthz` and someone who responds.
- Backups. `pg_dump` nightly to object storage, and **test a restore once**.
  An untested backup is not a backup.
- Data protection. You are now processing personal data of Indian residents
  under the DPDP Act 2023 on behalf of Core Value Realty. Get a written data
  processing clause into the retainer. It's their liability primarily, but you
  will be the one blamed and the one with the database.
- Exit. When this client leaves, who keeps the CRM? Decide now and put it in
  writing, not when the relationship is already going badly.

Budget roughly 4–6 hours a month of ongoing maintenance per client on this
stack, and price the retainer accordingly. Agencies routinely build these for
free as a "value add" and then discover it's a permanent unpaid liability.

---

## Sources

- [How to set up a webhook integration for a lead form — Google Ads Help](https://support.google.com/google-ads/answer/16729613?hl=en)
- [Lead Form Webhook overview — Google for Developers](https://developers.google.com/google-ads/webhook/docs/overview)
- [Lead Form Webhook implementation — Google for Developers](https://developers.google.com/google-ads/webhook/docs/implementation)
- [Meta Webhooks for Lead Ads — Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/quickstart/webhooks-integration)
- [Retrieving Leads — Meta for Developers](https://developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads/retrieving)
- [Leads webhooks — Meta for Developers](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-leadgen/)
