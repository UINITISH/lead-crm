/**
 * Help Center content — one entry per feature area. Kept as plain data (not
 * hardcoded into HelpPage.jsx) so adding or updating a topic later never
 * means touching the accordion/search UI itself.
 *
 * `keywords` is a plain-text blurb the search box matches against, since
 * matching raw JSX would be a lot more code for no real benefit here.
 */
export const HELP_TOPICS = [
  {
    id: 'leads',
    title: 'Leads: status vs. tags, editing, and the activity thread',
    keywords: 'leads status tag pipeline pickup closed not interested warm cold junk scheduled kebab edit delete duplicate activity notes',
    body: (
      <>
        <p>
          Every enquiry — from a website form, Meta, Google, or typed in by hand — lands here. Two things look similar
          but do different jobs:
        </p>
        <h3>Status</h3>
        <p>
          <strong>Pickup → Closed / Not interested.</strong> This is the pipeline stage. Every new lead starts at
          Pickup.
        </p>
        <h3>Tag</h3>
        <p>
          <strong>Warm, Cold, Junk, Scheduled</strong> — or anything else you add in Settings → Lead tags. This is a
          separate, informational label, independent of status. A lead can be "Pickup" and "warm" at the same time, or
          "Pickup" and "junk". Use it for call outcomes: no answer, invalid number, coordinating on WhatsApp, ready
          for a site visit — whatever your team actually says day to day.
        </p>
        <h3>Editing right from the table</h3>
        <p>
          Both Status and Tag are dropdowns directly in the Leads table — change either without opening the lead first.
          Clicking anywhere else on the row opens the full lead panel: contact info, developer/project, budget, where
          the lead came from (campaign/ad), and the <strong>Activity</strong> thread, where anyone on the team can post a
          free-text update — "called yesterday, no answer", "ready to visit the site Sunday" — building a running
          history of what's actually happened with that person.
        </p>
        <h3>The ⋮ menu</h3>
        <p>
          Next to every lead, the three-dot menu opens Edit (name, phone, email, source, developer(s), project, budget)
          or Delete (removes the lead and its whole history — can't be undone).
        </p>
        <h3>Duplicates</h3>
        <p>
          If the same phone number submits again within the duplicate-lead window (Settings → App behavior, 30 days by
          default), the new submission is stored but flagged as a duplicate and excluded from the default Leads list
          and reports — so your numbers stay honest without losing the record entirely.
        </p>
      </>
    ),
  },
  {
    id: 'lead-forms',
    title: 'Lead forms: build-your-own forms for WordPress (or anywhere)',
    keywords: 'lead forms wordpress embed iframe field types text email paragraph dropdown checkboxes budget project preview edit turn off delete no code',
    body: (
      <>
        <p>
          Build a form here, paste one line of HTML into WordPress, and every submission lands straight in Leads
          tagged <strong>source: website</strong> — no plugin, no Zapier, nothing to configure on the WordPress side.
        </p>
        <h3>Field types</h3>
        <p>
          <strong>Text, Email, Paragraph</strong> — the basics. <strong>Dropdown</strong> and <strong>Checkboxes</strong> let
          you define your own list of options (checkboxes allow picking more than one). <strong>Budget</strong> offers
          a preset set of ranges. <strong>Project</strong> pulls a live dropdown from your Developers &amp; projects
          directory — you can pin it to one developer so it only lists that builder's projects. Phone number is always
          collected automatically and can't be removed — it's how the CRM matches and de-duplicates leads.
        </p>
        <h3>Preview</h3>
        <p>
          "Preview" shows exactly what a visitor will see — while you're still building the form, or any time after,
          from the form's card in the list. Nothing typed into a preview is ever saved.
        </p>
        <h3>Edit anytime</h3>
        <p>
          Nothing is locked in after creation — reopen a form with "Edit" to rename it, add or remove fields, or change
          its options.
        </p>
        <h3>Turn off vs. delete</h3>
        <p>
          "Turn off" stops new submissions immediately without losing the form, its embed link, or the leads it's
          already captured. "Delete" removes the form entirely — but leads it already captured stay in your Leads
          list either way.
        </p>
        <h3>Answers to custom fields</h3>
        <p>
          Anything typed into a Dropdown/Checkboxes/custom field shows up automatically in that lead's Activity
          thread — a rep sees it right away, without digging into raw data.
        </p>
      </>
    ),
  },
  {
    id: 'meta',
    title: 'Meta (Facebook / Instagram) Lead Ads',
    keywords: 'meta facebook instagram lead ads instant form webhook app secret verify token page access token app review graph api',
    body: (
      <>
        <p>
          Facebook/Instagram "Instant Forms" live entirely inside the Meta app — there's no page to embed anything
          into, so this works differently from the Lead Forms feature above. Instead, Meta sends each submission to a
          webhook your CRM already has built in, then pulls the full lead (name, phone, campaign, ad) via their API.
        </p>
        <h3>Where to check status</h3>
        <p>
          Settings → Integrations shows your exact webhook URL and whether <code>META_VERIFY_TOKEN</code>,{' '}
          <code>META_APP_SECRET</code>, and <code>META_PAGE_ACCESS_TOKEN</code> are set.
        </p>
        <h3>Setup, in short</h3>
        <p>
          Needs a public HTTPS URL (not localhost) → a Meta Developer App with the Webhooks product, subscribed to the
          Page's <code>leadgen</code> field → a Page Access Token with lead-retrieval permissions → and, to receive
          leads at scale (not just your own test page), Meta's App Review process. Ask me to walk through any of these
          steps again any time — nothing here has to be memorized.
        </p>
      </>
    ),
  },
  {
    id: 'google',
    title: 'Google Ads Lead Form',
    keywords: 'google ads lead form webhook integration key gclid campaign',
    body: (
      <>
        <p>
          Simpler than Meta — no app review needed. Open the lead form asset in Google Ads, find its "Webhook
          integration" section, and paste in the webhook URL and key shown under Settings → Integrations (the key is
          set as <code>GOOGLE_WEBHOOK_KEY</code> in your environment). Google posts each submission straight to the
          CRM, tagged <strong>source: google</strong> with campaign/ad group attribution attached.
        </p>
      </>
    ),
  },
  {
    id: 'website-webhook',
    title: 'Website contact form (developer-signed, for a custom-built site)',
    keywords: 'website form hmac signature secret custom developer server side',
    body: (
      <>
        <p>
          This is different from Lead Forms above. It's a server-to-server endpoint that expects each submission to be
          cryptographically signed with a shared secret (<code>WEBSITE_INGEST_SECRET</code>) — meant for a
          custom-built website where a developer can add that signing step on the server side. It's more locked-down,
          but needs code on your end.
        </p>
        <p>
          If you don't have a developer maintaining your website's backend, use <strong>Lead Forms</strong> instead —
          same result, no code required, just paste an iframe.
        </p>
      </>
    ),
  },
  {
    id: 'developers-projects',
    title: 'Developers & projects directory',
    keywords: 'developers projects directory grade unit types area possession multi developer',
    body: (
      <>
        <p>
          The directory every developer/project dropdown across the CRM pulls from — grouped A-Grade / B-Grade /
          Other, each with its projects and unit-type breakdown (configuration, size, price range). Typing a new
          developer or project name anywhere else in the CRM (like Add Lead) creates it here automatically if it
          doesn't already exist — nothing has to be pre-loaded first.
        </p>
        <p>
          A lead can carry more than one developer (picked via checkboxes wherever you add or edit a lead) — useful
          when someone's genuinely comparing options across builders.
        </p>
      </>
    ),
  },
  {
    id: 'tickets',
    title: 'Support tickets',
    keywords: 'tickets support department priority status assignee requester urgent open resolved closed',
    body: (
      <>
        <p>
          A ticket is a discrete, assignable piece of work — a stuck loan sanction letter, a documentation problem, a
          payments query — distinct from a lead's follow-ups (a simple reminder) or its activity thread (a running
          log). Set a department, priority, and who it's assigned to; move it through{' '}
          <strong>Open → In progress → Resolved → Closed</strong> the same way a lead moves through its pipeline.
        </p>
        <p>
          Every status change or note is kept in the ticket's own Activity thread, same pattern as a lead's — so
          nothing about who did what gets lost once it's marked closed.
        </p>
      </>
    ),
  },
  {
    id: 'lead-list-polish',
    title: 'Occurrences, repeat enquiries, and the card view',
    keywords: 'occurrences duplicates repeat enquiry card view list view grid toggle',
    body: (
      <>
        <p>
          The <strong>Occ.</strong> column on Leads shows how many times that same phone number has enquired — a
          quiet ×2 or ×3 badge, not a separate inflated lead. Open the lead and its "Repeat enquiries" section lists
          each earlier submission (source, date) that got folded into it.
        </p>
        <p>
          The list/card toggle next to the filters switches the Leads page between the classic table and a card grid
          — same data, same inline Status/Tag editing, just easier to scan on a smaller screen. Your choice is
          remembered for next time.
        </p>
      </>
    ),
  },
  {
    id: 'settings',
    title: 'Settings, section by section',
    keywords: 'settings company name dedupe window team reps lead tags data management wipe test leads reseed access token',
    body: (
      <>
        <p><strong>App behavior</strong> — your company name shown in the sidebar, and the duplicate-lead window (how many days before a repeat phone number counts as a fresh lead instead of a duplicate).</p>
        <p><strong>Team</strong> — the list "Acting as" picks from in the sidebar, so activity and the leaderboard group by one consistent name per person instead of however someone happened to type it.</p>
        <p><strong>Lead tags</strong> — add, recolor, or deactivate the tags available in every Tag dropdown across the CRM.</p>
        <p><strong>Data management</strong> — live counts of everything in your database, a one-click wipe of leads flagged as test data, and a way to re-seed the developer directory (only runs if it's empty — never overwrites real data).</p>
        <p><strong>Access</strong> — re-enter your admin token here if you ever need to switch it or clear a stale one.</p>
      </>
    ),
  },
  {
    id: 'access',
    title: 'Admin access & the token',
    keywords: 'admin token bearer login access password authentication',
    body: (
      <>
        <p>
          Right now everyone with access to this CRM shares one admin token — there are no individual logins yet
          (that's on the roadmap). Locally, it's filled in for you automatically the first time you open the app; on a
          real deployment, you'll be prompted for it once and it's then remembered in your browser. If it's ever
          wrong or you need to switch it, use Settings → Access → "Re-enter admin token".
        </p>
      </>
    ),
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting common issues',
    keywords: 'troubleshooting not showing missing leads filters cache refresh problem broken',
    body: (
      <>
        <p><strong>A lead I just added isn't showing up.</strong> Check the Source/Status/Tag filters and the search box at the top of Leads aren't hiding it, and that it wasn't flagged as a duplicate (same phone number seen recently).</p>
        <p><strong>A lead form isn't accepting submissions.</strong> Check its card on the Lead forms page — it may be switched to "Turn off".</p>
        <p><strong>Meta or Google leads aren't arriving.</strong> Check Settings → Integrations — a missing key (shown as a red "missing" pill) is almost always the cause.</p>
        <p><strong>Something on screen looks out of date.</strong> Try a hard refresh of the browser tab first — it usually fixes a stale page.</p>
        <p>Still stuck on something? Just describe what you're seeing — that's always faster than digging through this on your own.</p>
      </>
    ),
  },
];
