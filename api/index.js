/**
 * Vercel serverless entry point.
 *
 * Vercel has no long-running process — every request may hit a fresh "cold
 * start", so unlike src/server.js's start() (which listens on a port once
 * and stays up), here the DB connection + schema migration happen at MODULE
 * LOAD time via top-level await. Vercel keeps a warm function instance alive
 * across nearby requests, so this only re-runs on an actual cold start, not
 * on every request. migrate() is safe to re-run any number of times — every
 * statement in db/schema.sql is CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
 * NOT EXISTS, and the reference-data seeds are guarded on "table is empty".
 *
 * DATABASE_URL is REQUIRED here (set it in the Vercel project's environment
 * variables) — there's no writable local disk on Vercel, so the PGlite
 * fallback src/db.js uses for local dev cannot work in this environment.
 */
import { app } from '../src/server.js';
import { initDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.trim()) {
  console.error('[vercel] DATABASE_URL is not set — this app cannot run on Vercel without a real Postgres database.');
}

await initDb();
await migrate();

export default app;
