/**
 * Normalisation helpers.
 *
 * Why this file exists: Meta sends "+91 98765 43210", Google sends
 * "+919876543210", your website form sends "9876543210" and the receptionist
 * types "098765 43210". Those are one human being. If you don't collapse them
 * to a single canonical form, your dedupe does nothing and every number you
 * report to the client is inflated.
 */

const DEFAULT_CC = '91'; // India

/**
 * Best-effort E.164 normalisation, India-first.
 * Returns null if the input can't plausibly be a phone number — the caller
 * should reject the lead rather than store garbage.
 */
export function normalizePhone(input, defaultCc = DEFAULT_CC) {
  if (input == null) return null;
  let s = String(input).trim();
  if (!s) return null;

  const hadPlus = s.startsWith('+');
  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  // Strip Indian trunk prefix and international dial-out prefix.
  if (!hadPlus) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  }

  // Already carries the country code.
  if (digits.length === 12 && digits.startsWith(defaultCc)) {
    const sub = digits.slice(2);
    return isIndianMobile(sub) ? `+${digits}` : null;
  }

  // Bare 10-digit Indian mobile.
  if (digits.length === 10) {
    return isIndianMobile(digits) ? `+${defaultCc}${digits}` : null;
  }

  // Explicit international number we don't have rules for — keep it if the
  // length is sane, rather than silently dropping a real lead.
  if (hadPlus && digits.length >= 8 && digits.length <= 15) return `+${digits}`;

  return null;
}

function isIndianMobile(tenDigits) {
  return /^[6-9]\d{9}$/.test(tenDigits);
}

export function normalizeEmail(input) {
  if (input == null) return null;
  const s = String(input).trim().toLowerCase();
  if (!s) return null;
  // Deliberately permissive: a slightly-odd address is still a lead.
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s) ? s : null;
}

export function cleanText(input, max = 500) {
  if (input == null) return null;
  const s = String(input).replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.slice(0, max);
}

/**
 * Pull click identifiers and UTMs out of a flat object (query params, form
 * fields, or the tracker.js blob). Case-insensitive on keys.
 */
const ATTR_KEYS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'wbraid', 'gbraid', 'fbclid', 'msclkid',
];

export function extractAttribution(obj = {}) {
  const lower = {};
  for (const [k, v] of Object.entries(obj || {})) {
    lower[String(k).toLowerCase()] = v;
  }
  const out = {};
  for (const key of ATTR_KEYS) {
    out[key] = cleanText(lower[key], 300);
  }
  out.landing_page = cleanText(lower.landing_page ?? lower.landingpage ?? lower.page_url, 1000);
  out.referrer = cleanText(lower.referrer ?? lower.referer, 1000);
  return out;
}

/**
 * Infer the channel when the payload doesn't declare it.
 * Order matters: explicit click IDs beat UTMs, because UTMs are hand-typed by
 * whoever built the campaign and are wrong more often than anyone admits.
 */
export function inferSource(attr = {}) {
  if (attr.gclid || attr.wbraid || attr.gbraid) return 'google';
  if (attr.fbclid) return 'meta';
  const s = (attr.utm_source || '').toLowerCase();
  if (/(google|adwords|gads|youtube)/.test(s)) return 'google';
  if (/(facebook|fb|meta|instagram|ig)/.test(s)) return 'meta';
  return 'website';
}
