/**
 * Multi-tenant auth — one login per business (client), not per staff member.
 * Everyone at a given client shares that one login, same as the old shared
 * ADMIN_TOKEN did for Core Value Realty alone; the difference now is every
 * client gets their OWN login and can only ever see their own data.
 *
 * Two independent primitives:
 *   - Password hashing (scrypt, Node's built-in — no bcrypt/argon2 native
 *     dependency to worry about breaking on Vercel's build image).
 *   - Session tokens: stateless, HMAC-signed. No sessions table, no cleanup
 *     job for expired rows — verifying a token is just re-computing the
 *     signature and checking the expiry embedded in the payload. This is
 *     deliberately NOT a JWT library: the format is `payload.signature`
 *     (both base64url), which is the same shape minus the parts of the JWT
 *     spec (alg negotiation, JOSE headers) this app has no use for and that
 *     are also where most JWT footguns live (alg:none, alg confusion).
 *
 * Provisioning a new client is NOT an HTTP endpoint — there is no
 * "create business" API route, on purpose. It's a local CLI script
 * (scripts/create-business.js) run against the live DATABASE_URL by
 * whoever operates this platform. That avoids needing a second, higher-
 * privileged "super-admin" login system just to gate a feature only one
 * person ever uses.
 */
import crypto from 'node:crypto';
import { query, one } from './db.js';

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET;
  if (secret && secret.trim()) return secret;
  if (process.env.NODE_ENV === 'production') {
    console.error('[auth] SESSION_SECRET is not set. Refusing to start in production.');
    process.exit(1);
  }
  return 'local-dev-session-secret-not-for-production';
}

// --- passwords ---------------------------------------------------------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  // Lengths must match before timingSafeEqual will even compare — a bad
  // stored hash (wrong length) would otherwise throw instead of just
  // failing the login.
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

// --- session tokens ------------------------------------------------------
function sign(payloadB64) {
  return crypto.createHmac('sha256', getSessionSecret()).update(payloadB64).digest('base64url');
}

/**
 * loginId is null when this session was issued for the business's own
 * primary email, or a business_logins.id when it was issued for an added
 * login — carried through so every later request on this session can look
 * up that SPECIFIC login's own restrictions (see getEffectiveHiddenPages),
 * not just the business-wide ones.
 */
export function issueSessionToken(business, loginId = null) {
  const payload = { business_id: business.id, login_id: loginId, exp: Date.now() + SESSION_TTL_MS };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64)}`;
}

/** Returns { business_id, login_id } if the token is validly signed and unexpired, else null. */
export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payloadB64, sig] = token.split('.');
  const expected = sign(payloadB64);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload.business_id || !payload.exp || Date.now() > payload.exp) return null;
  return { business_id: payload.business_id, login_id: payload.login_id || null };
}

// --- business accounts -----------------------------------------------------
export async function findBusinessByEmail(email) {
  return one(`SELECT * FROM businesses WHERE LOWER(email) = LOWER($1)`, [email]);
}

export async function findBusinessBySlug(slug) {
  if (!slug) return null;
  return one(`SELECT id, name, slug FROM businesses WHERE slug = LOWER($1) AND is_active = TRUE`, [slug]);
}

/** "Core Value Realty RE" -> "core-value-realty-re". Used for the login-link slug. */
export function slugify(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'business';
}

/** Appends -2, -3, … until it finds a slug not already taken by another business. */
async function uniqueSlug(base, excludeId = null) {
  let candidate = base;
  let n = 2;
  for (;;) {
    const clash = excludeId
      ? await one(`SELECT id FROM businesses WHERE slug = $1 AND id <> $2`, [candidate, excludeId])
      : await one(`SELECT id FROM businesses WHERE slug = $1`, [candidate]);
    if (!clash) return candidate;
    candidate = `${base}-${n++}`;
  }
}

/** One-time backfill for rows created before the slug column existed. */
export async function backfillBusinessSlugs() {
  const rows = await query(`SELECT id, name FROM businesses WHERE slug IS NULL`);
  for (const row of rows.rows) {
    const slug = await uniqueSlug(slugify(row.name), row.id);
    await query(`UPDATE businesses SET slug = $1 WHERE id = $2`, [slug, row.id]);
  }
}

export async function getBusiness(id) {
  return one(`SELECT * FROM businesses WHERE id = $1`, [id]);
}

/**
 * Resolves an email to which record actually owns it — the business's own
 * primary login (loginId: null), or a specific business_logins row
 * (loginId: that row's id) — without checking a password. Shared by
 * authenticateBusiness and the hidden_pages-restriction tooling, which both
 * need to know WHICH login this is, not just which business_id it resolves
 * to, since restrictions can now be scoped to one specific login.
 */
async function resolveLogin(email) {
  const business = await findBusinessByEmail(email);
  if (business) {
    return { business, loginId: null, passwordHash: business.password_hash, loginHiddenPages: [] };
  }
  const row = await one(
    `SELECT bl.id AS login_id, bl.password_hash AS login_password_hash, bl.hidden_pages AS login_hidden_pages, b.*
       FROM business_logins bl JOIN businesses b ON b.id = bl.business_id
      WHERE LOWER(bl.email) = LOWER($1)`,
    [email],
  );
  if (!row) return null;
  const { login_id, login_password_hash, login_hidden_pages, ...business2 } = row;
  return { business: business2, loginId: login_id, passwordHash: login_password_hash, loginHiddenPages: login_hidden_pages || [] };
}

/**
 * Union of what's hidden for the whole business and what's hidden for one
 * specific login — the business-wide list always applies to everyone, and a
 * specific login can have MORE hidden on top of that (but never less; there's
 * no way for a login to see a page the business itself has hidden).
 */
function mergeHiddenPages(businessHiddenPages, loginHiddenPages) {
  return [...new Set([...(businessHiddenPages || []), ...(loginHiddenPages || [])])];
}

/**
 * Returns the business row (password excluded) on success, null on bad
 * credentials. Checks the business's own primary email+password first, then
 * falls back to business_logins — an extra login added on top of an
 * existing business via scripts/add-login.js, which resolves to the exact
 * same business_id and therefore the exact same leads/data. Whoever logs in
 * with either credential ends up looking at one shared account's data, on
 * purpose — but hidden_pages can still differ per login (see
 * mergeHiddenPages), so a colleague's login can be restricted without
 * touching the business owner's own primary login.
 */
export async function authenticateBusiness(email, password) {
  const resolved = await resolveLogin(email);
  if (!resolved) return null;
  const { business, loginId, passwordHash, loginHiddenPages } = resolved;
  if (!business.is_active || !passwordHash || !verifyPassword(password, passwordHash)) return null;
  const { password_hash, hidden_pages, ...safe } = business;
  return { ...safe, login_id: loginId, hidden_pages: mergeHiddenPages(hidden_pages, loginHiddenPages) };
}

/**
 * Re-checked on every request (see the session middleware in
 * src/routes/admin.js) rather than baked into the token, so a restriction
 * set via scripts/set-hidden-pages.js takes effect immediately for anyone
 * already logged in, not just on their next login.
 */
export async function getEffectiveHiddenPages(businessId, loginId) {
  const biz = await one(`SELECT hidden_pages FROM businesses WHERE id = $1`, [businessId]);
  if (!loginId) return biz?.hidden_pages || [];
  const login = await one(`SELECT hidden_pages FROM business_logins WHERE id = $1`, [loginId]);
  return mergeHiddenPages(biz?.hidden_pages, login?.hidden_pages);
}

/**
 * The Meta/Google ad webhooks and the legacy /api/leads/website endpoint
 * aren't per-client yet (see module comment in scripts/create-business.js) —
 * for this pass they all attribute incoming leads to whichever business was
 * created first, which in practice is Core Value Realty's own account.
 * Revisit this the day a second client actually needs their own ad account
 * wired up.
 */
export async function getDefaultBusinessId() {
  const row = await one(`SELECT id FROM businesses ORDER BY created_at ASC LIMIT 1`);
  return row ? row.id : null;
}

/** Used by scripts/create-business.js — creates a new client, or updates an existing one's password if the email already exists. */
export async function upsertBusiness({ name, email, password }) {
  const existing = await findBusinessByEmail(email);
  const password_hash = hashPassword(password);
  if (existing) {
    const slug = existing.slug || (await uniqueSlug(slugify(name || existing.name), existing.id));
    const res = await query(
      `UPDATE businesses SET name = $1, password_hash = $2, slug = $4 WHERE id = $3 RETURNING id, name, email, slug, created_at`,
      [name || existing.name, password_hash, existing.id, slug],
    );
    return { business: res.rows[0], created: false };
  }
  const slug = await uniqueSlug(slugify(name));
  const res = await query(
    `INSERT INTO businesses (name, email, password_hash, slug) VALUES ($1, $2, $3, $4) RETURNING id, name, email, slug, created_at`,
    [name, email, password_hash, slug],
  );
  return { business: res.rows[0], created: true };
}

/**
 * Resolves an email to { business, loginId } without checking a password —
 * loginId is null for a business's own primary login, or a
 * business_logins.id for one added on top via scripts/add-login.js. Used by
 * scripts/set-hidden-pages.js to figure out whether restricting a given
 * email should touch the whole business (and every login that shares it) or
 * just that one specific added login.
 */
export async function findLoginByEmail(email) {
  const resolved = await resolveLogin(email);
  if (!resolved) return null;
  return { business: resolved.business, loginId: resolved.loginId };
}

/**
 * Sets which page keys (NAV keys in client/src/constants.js — 'settings',
 * 'forms', 'ingest', etc.) are hidden BUSINESS-WIDE — every login that
 * resolves to this business_id (primary email + any business_logins rows)
 * inherits this, on top of whatever's set for their own specific login (see
 * setLoginHiddenPages). Call this for the business's own primary email.
 */
export async function setHiddenPages(businessId, pages) {
  const res = await query(
    `UPDATE businesses SET hidden_pages = $1 WHERE id = $2 RETURNING id, name, email, slug, hidden_pages`,
    [pages, businessId],
  );
  return res.rows[0] || null;
}

/**
 * Sets which page keys are hidden for ONE SPECIFIC added login, without
 * touching the business itself or any other login that shares its data.
 * Call this for an email that resolved to a business_logins.id (not the
 * business's own primary email).
 */
export async function setLoginHiddenPages(loginId, pages) {
  const res = await query(
    `UPDATE business_logins SET hidden_pages = $1 WHERE id = $2 RETURNING id, business_id, email, hidden_pages`,
    [pages, loginId],
  );
  return res.rows[0] || null;
}

/**
 * Used by scripts/add-login.js — adds another email+password that resolves
 * to an EXISTING business's data, rather than creating a new isolated
 * tenant. Re-running with the same email updates that login's password
 * instead of erroring (findBusinessByEmail is checked too, so this can't
 * silently shadow the business's own primary login).
 */
export async function addLoginToBusiness({ businessId, email, password }) {
  const clash = await findBusinessByEmail(email);
  if (clash && clash.id !== businessId) {
    throw new Error(`${email} is already the primary login for a different business ("${clash.name}").`);
  }
  const password_hash = hashPassword(password);
  const res = await query(
    `INSERT INTO business_logins (business_id, email, password_hash) VALUES ($1, $2, $3)
       ON CONFLICT (LOWER(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash, business_id = EXCLUDED.business_id
     RETURNING id, business_id, email, created_at`,
    [businessId, email, password_hash],
  );
  return res.rows[0];
}
