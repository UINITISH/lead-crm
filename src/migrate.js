/**
 * Applies db/schema.sql. Idempotent — safe to re-run.
 * Usage: npm run migrate
 */
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { initDb, exec, closeDb } from './db.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function migrate() {
  await initDb();
  const sql = await readFile(path.join(here, '..', 'db', 'schema.sql'), 'utf8');
  await exec(sql);
  console.log('[migrate] schema applied');
}

// pathToFileURL, not string concatenation — a space in the path (e.g. anything
// under "Application Support") makes the naive comparison silently false.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  migrate()
    .then(() => closeDb())
    .catch((e) => {
      console.error('[migrate] failed:', e);
      process.exit(1);
    });
}
