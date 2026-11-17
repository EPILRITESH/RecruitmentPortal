// Express app shared by both runtimes (Node.js: index.js, Cloudflare Workers: worker.js)
import express from 'express';
import { get, setting, setSetting } from './db.js';
import { seedSteps } from './workflow.js';
import { seedTemplates } from './notify.js';
import { requireAuth } from './auth.js';
import { bootstrap } from './seed.js';
import { readUpload } from './storage.js';
import coreRoutes from './routes/core.js';
import recruitRoutes from './routes/recruit.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';

let ready = null;
/** First-run seeding (steps, templates, default users). Runs once per process/isolate. */
export function ensureReady() {
  ready ||= (async () => {
    if (!(await get('SELECT code FROM steps LIMIT 1'))) await seedSteps();
    if (!(await get('SELECT key FROM templates LIMIT 1'))) await seedTemplates();
    if (!(await get('SELECT id FROM users LIMIT 1'))) await bootstrap();
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  app.use(async (req, res, next) => {
    try { await ensureReady(); next(); } catch (e) { next(e); }
  });

  // Remember the real public address so WhatsApp form links point to the live site
  app.use(async (req, res, next) => {
    try {
      const host = req.headers['x-forwarded-host'] || req.headers.host || '';
      if (host && !/localhost|127\.0\.0\.1/.test(host)) {
        const cur = await setting('public_url', '');
        if (!cur || /localhost/.test(cur)) await setSetting('public_url', `https://${host}`);
      }
    } catch { /* not critical */ }
    next();
  });

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/public', publicRoutes);
  app.get('/api/files/:name', requireAuth, async (req, res) => {
    const f = await readUpload(req.params.name);
    if (!f) return res.status(404).json({ error: 'File not found' });
    res.setHeader('Content-Type', f.type);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(f.body);
  });
  app.use('/api', coreRoutes);
  app.use('/api', reportRoutes);
  app.use('/api', recruitRoutes);
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}

export function errorHandler(app) {
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Server error: ' + err.message : err.message });
  });
}
