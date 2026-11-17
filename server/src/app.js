// Express app shared by both runtimes (Node.js: index.js, Cloudflare Workers: worker.js)
import express from 'express';
import crypto from 'node:crypto';
import { get, run, setting, setSetting } from './db.js';
import { seedSteps, STEP_DEFS, repairStuckCandidates } from './workflow.js';
import { seedAutomations } from './automation.js';
import { seedTemplates } from './notify.js';
import { requireAuth } from './auth.js';
import { bootstrap } from './seed.js';
import { readUpload } from './storage.js';
import coreRoutes from './routes/core.js';
import recruitRoutes from './routes/recruit.js';
import reportRoutes from './routes/reports.js';
import jobRoutes, { seedPlatforms } from './routes/jobs.js';
import misRoutes from './routes/mis.js';
import publicRoutes from './routes/public.js';

const SEED_VERSION = '2';
let ready = null;
/** Seeding / upgrades (steps, templates, platforms, automations, default users). Runs once per process/isolate. */
export function ensureReady() {
  ready ||= (async () => {
    if ((await setting('seed_version', '')) === SEED_VERSION) return;
    await seedSteps();
    // keep step options / fields in line with the code (names, TAT and doers stay as edited in Settings)
    for (const s of STEP_DEFS) await run('UPDATE steps SET options=?, fields=? WHERE code=?', JSON.stringify(s.options), JSON.stringify(s.fields || []), s.code);
    await seedTemplates();
    await seedPlatforms();
    await seedAutomations();
    if (!(await setting('inbound_token'))) await setSetting('inbound_token', crypto.randomBytes(12).toString('hex'));
    if (!(await get('SELECT id FROM users LIMIT 1'))) await bootstrap();
    await repairStuckCandidates();
    await setSetting('seed_version', SEED_VERSION);
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
  app.use('/api', misRoutes);
  app.use('/api', jobRoutes);
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
