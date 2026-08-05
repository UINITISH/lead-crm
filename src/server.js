import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { initDb } from './db.js';
import { migrate } from './migrate.js';
import { websiteRouter } from './routes/website.js';
import { metaRouter } from './routes/meta.js';
import { googleRouter } from './routes/google.js';
import { adminRouter } from './routes/admin.js';
import { publicFormRouter } from './routes/publicForm.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const app = express();

app.set('trust proxy', 1); // behind nginx on the VPS

// Raw body is required for HMAC verification (Meta + our website endpoint).
app.use(express.json({
  limit: '256kb',
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// CORS, only for the browser-direct fallback path.
app.use((req, res, next) => {
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.get('Origin');
  if (origin && allowed.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, X-CRM-Signature');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/healthz', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

app.use('/api/leads', websiteRouter);
app.use('/api/leads', metaRouter);
app.use('/api/leads', googleRouter);
app.use('/api/admin', adminRouter);
app.use('/f', publicFormRouter);

app.use(express.static(path.join(here, '..', 'public')));

// SPA fallback — vanity login URLs (findmigo.com/<business-slug>) aren't real
// files, they're client-side routes the React app itself reads from
// location.pathname. Anything that isn't an API route and isn't a static
// asset that actually exists gets index.html, same as Vercel's rewrite does
// in production (see vercel.json).
app.get('*', (req, res) => {
  res.sendFile(path.join(here, '..', 'public', 'index.html'));
});

app.use((err, _req, res, _next) => {
  console.error('[unhandled]', err);
  res.status(500).json({ ok: false, error: 'Internal error' });
});

export async function start() {
  // Nothing below is allowed to fail silently. npm can swallow a rejected
  // top-level promise and hand you back a bare shell prompt with no clue why.
  process.on('uncaughtException', (err) => {
    console.error('\n[server] uncaught exception:\n', err);
    process.exit(1);
  });
  process.on('unhandledRejection', (err) => {
    console.error('\n[server] unhandled rejection:\n', err);
    process.exit(1);
  });

  console.log(`[server] node ${process.version} · starting…`);
  await initDb();
  await migrate();
  // 3400 by default: 3000 and 3100 are already taken by other projects here.
  const port = Number(process.env.PORT || 3400);
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      console.log(`[server] listening on http://localhost:${port}`);
      resolve(server);
    });
    // Without this you get an unhandled EADDRINUSE crash dump instead of a
    // sentence telling you what's already on the port.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(
          `\n[server] port ${port} is already in use.\n` +
          `[server] Find what's on it:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
          `[server] Or pick another:    PORT=3500 npm start\n`,
        );
        process.exit(1);
      }
      reject(err);
    });
  });
}

// Run directly? Start the server.
// The plain `file://${argv[1]}` comparison breaks whenever the path contains
// characters that need URL-encoding — and this project lives under
// "Application Support", so the space alone was enough to make this false and
// exit without a word. pathToFileURL encodes it properly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await start();
  const shutdown = () => {
    console.log('\n[server] shutting down…');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
