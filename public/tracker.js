/*!
 * Core Realty — attribution tracker
 * Drop this on every page of the site, BEFORE any form script.
 *
 * WHY THIS EXISTS
 * The spec's schema records source = 'website' for every site lead. That is not
 * an answer to "where did this lead come from" — it's the absence of one. A
 * visitor clicks a Meta ad, lands on /projects, browses, leaves, comes back two
 * days later from a Google search, and submits. Without this file the CRM sees
 * a direct visit and the ad that actually paid for the lead gets no credit.
 *
 * WHAT IT DOES
 *  - Captures utm_*, gclid, wbraid, gbraid, fbclid, msclkid on arrival
 *  - Stores FIRST touch permanently and LAST non-direct touch on each visit
 *  - Survives navigation and return visits (localStorage, 90-day window)
 *  - Injects the whole thing as a hidden `attribution` field on every form
 *
 * PRIVACY: click IDs and UTMs are campaign metadata, not personal data. Still,
 * make sure Core Realty's privacy policy mentions advertising measurement
 * cookies before this goes live. DPDP Act 2023 applies to them, and it's their
 * exposure, not yours — but you'll be blamed for it anyway.
 */
(function () {
  'use strict';

  var KEY = 'cr_attr_v1';
  var MAX_AGE_DAYS = 90;

  var PARAMS = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
    'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid',
  ];

  function readStore() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      var age = (Date.now() - (parsed.updated_at || 0)) / 86400000;
      return age > MAX_AGE_DAYS ? null : parsed;
    } catch (e) { return null; }
  }

  function writeStore(data) {
    try {
      data.updated_at = Date.now();
      window.localStorage.setItem(KEY, JSON.stringify(data));
    } catch (e) { /* private mode; degrade to session-only */ }
  }

  function currentTouch() {
    var qs = new URLSearchParams(window.location.search);
    var touch = { captured_at: new Date().toISOString() };
    var hasAny = false;

    PARAMS.forEach(function (p) {
      var v = qs.get(p);
      if (v) { touch[p] = v.slice(0, 300); hasAny = true; }
    });

    touch.landing_page = window.location.href.slice(0, 1000);
    touch.referrer = document.referrer ? document.referrer.slice(0, 1000) : '';

    // Organic search / social referral with no tagging — still better than "direct".
    if (!hasAny && touch.referrer) {
      var host = '';
      try { host = new URL(touch.referrer).hostname.replace(/^www\./, ''); } catch (e) {}
      if (host && host !== window.location.hostname.replace(/^www\./, '')) {
        touch.utm_source = host;
        touch.utm_medium = 'referral';
        hasAny = true;
      }
    }

    return hasAny ? touch : null;
  }

  var store = readStore() || { first_touch: null, last_touch: null, sessions: 0 };
  var touch = currentTouch();

  store.sessions = (store.sessions || 0) + 1;
  if (touch) {
    if (!store.first_touch) store.first_touch = touch;
    store.last_touch = touch; // last NON-DIRECT touch wins; direct visits don't overwrite
  }
  if (!store.last_touch) {
    store.last_touch = {
      utm_source: 'direct', utm_medium: 'none',
      landing_page: window.location.href.slice(0, 1000),
      captured_at: new Date().toISOString(),
    };
  }
  writeStore(store);

  function payload() {
    return JSON.stringify({
      first_touch: store.first_touch,
      last_touch: store.last_touch,
      sessions: store.sessions,
      page_at_submit: window.location.href.slice(0, 1000),
    });
  }

  /** Stamp every form on the page with a hidden attribution field. */
  function stampForms() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      var f = forms[i];
      if (f.getAttribute('data-cr-attr') === '1') continue;
      f.setAttribute('data-cr-attr', '1');

      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'attribution';
      input.value = payload();
      f.appendChild(input);

      // Honeypot. Real users can't see it; bots fill everything.
      var hp = document.createElement('input');
      hp.type = 'text';
      hp.name = 'company_website';
      hp.tabIndex = -1;
      hp.autocomplete = 'off';
      hp.setAttribute('aria-hidden', 'true');
      hp.style.cssText = 'position:absolute!important;left:-9999px!important;opacity:0!important;height:0;width:0;';
      f.appendChild(hp);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', stampForms);
  } else {
    stampForms();
  }
  // Re-stamp for SPA route changes / dynamically injected forms.
  if (window.MutationObserver) {
    new MutationObserver(stampForms).observe(document.documentElement, { childList: true, subtree: true });
  }

  // Public API for React/Next forms that submit via fetch instead of a <form> post.
  window.CoreRealtyAttribution = {
    get: function () { return JSON.parse(payload()); },
    raw: function () { return payload(); },
  };
})();
