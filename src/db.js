/**
 * Database adapter.
 *
 * Two backends, one interface:
 *   - DATABASE_URL set  -> node-postgres (production)
 *   - otherwise         -> PGlite, Postgres-in-WASM (local dev / CI, no server)
 *
 * Same SQL either way, so local dev cannot drift from production semantics.
 */
import pg from 'pg';

let impl = null;

/**
 * A fresh deploy invalidates every warm Lambda instance, so the next burst of
 * page-load traffic (a dozen-plus parallel API calls per page load, times
 * however many people have the CRM open) cold-starts many instances at once,
 * each opening its own connection pool against the same small Render Postgres
 * plan. That's routinely enough to blow past Render's connection cap for a
 * few seconds, which shows up as "Connection terminated unexpectedly" (the
 * pool's own health check or a live query got dropped) or a spurious
 * "deadlock detected" on a plain read (lock manager thrashing under
 * connection churn, not an actual conflicting write). Both are transient —
 * gone within a second or two once the burst settles — so retrying briefly
 * turns them into a barely-noticeable delay instead of a 500 in the UI.
 */
const TRANSIENT_ERROR = /Connection terminated|ECONNRESET|ETIMEDOUT|deadlock detected|terminating connection/i;

async function withRetry(fn, { retries = 3, baseDelayMs = 200 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !TRANSIENT_ERROR.test(String(err?.message || ''))) throw err;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * (attempt + 1)));
    }
  }
}

export async function initDb() {
  if (impl) return impl;

  const url = process.env.DATABASE_URL;
  if (url && url.trim()) {
    // Managed Postgres (Render, Neon, Supabase, RDS, etc.) requires SSL on
    // external connections but signs with a cert `pg` won't validate against
    // a public CA bundle by default — without this the pool throws instantly
    // and every cold start crashes. A bare `localhost`/`127.0.0.1` URL (e.g.
    // a local Docker Postgres) is the only case that should skip it.
    const isLocal = /localhost|127\.0\.0\.1/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      ssl: isLocal ? false : { rejectUnauthorized: false },
      // Kept deliberately small: a fresh deploy can cold-start many Lambda
      // instances at once, and it's (instance count × max) connections
      // hitting Render at the same moment that exhausts its connection cap,
      // not steady-state traffic. A lower per-instance ceiling means more
      // instances can cold-start concurrently before that happens.
      max: 4,
      idleTimeoutMillis: 30_000,
      // Fail fast and let withRetry() try again with backoff, rather than
      // queuing silently until Vercel's own 30s function timeout fires.
      connectionTimeoutMillis: 8_000,
    });
    await withRetry(() => pool.query('SELECT 1'));
    impl = {
      kind: 'postgres',
      query: (text, params = []) => withRetry(() => pool.query(text, params)),
      exec: (sql) => withRetry(() => pool.query(sql)),          // multi-statement script
      close: () => pool.end(),
    };
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || './.pgdata';

    // A half-written data dir (interrupted seed, copied folder, killed process)
    // makes PGlite abort with a bare WASM "unreachable" trace that tells the
    // reader nothing. Catch it, move the bad dir aside, and start clean —
    // this is local dev data, not something worth failing the boot over.
    let lite;
    try {
      lite = await PGlite.create(dir);
    } catch (err) {
      const { rename } = await import('node:fs/promises');
      const quarantine = `${dir}.broken-${Date.now()}`;
      console.warn(
        `[db] could not open ${dir} (${err.message?.slice(0, 80)}).\n` +
        `[db] moving it to ${quarantine} and starting with a fresh database.`,
      );
      try { await rename(dir, quarantine); } catch { /* nothing to move */ }
      lite = await PGlite.create(dir);
    }
    impl = {
      kind: 'pglite',
      query: async (text, params = []) => lite.query(text, params),
      // PGlite's query() is single-statement only; exec() runs a whole script.
      exec: async (sql) => lite.exec(sql),
      close: () => lite.close(),
    };
  }

  console.log(`[db] connected via ${impl.kind}`);
  return impl;
}

export async function query(text, params = []) {
  if (!impl) await initDb();
  return impl.query(text, params);
}

/** Run a multi-statement SQL script (migrations). */
export async function exec(sql) {
  if (!impl) await initDb();
  return impl.exec(sql);
}

/** Convenience: first row or null. */
export async function one(text, params = []) {
  const r = await query(text, params);
  return r.rows[0] ?? null;
}

export async function closeDb() {
  if (impl) await impl.close();
  impl = null;
}

/** 'postgres' or 'pglite' — used by the Settings page, never exposes credentials. */
export async function getDbKind() {
  if (!impl) await initDb();
  return impl.kind;
}
