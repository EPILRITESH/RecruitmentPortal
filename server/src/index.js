process.env.TZ = process.env.TZ || 'Asia/Kolkata';

import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { get } from './db.js';
import { seedSteps } from './workflow.js';
import { seedTemplates } from './notify.js';
import { requireAuth } from './auth.js';
import { bootstrap } from './seed.js';
import coreRoutes from './routes/core.js';
import recruitRoutes, { UPLOAD_DIR } from './routes/recruit.js';
import reportRoutes from './routes/reports.js';
import publicRoutes from './routes/public.js';

seedSteps();
seedTemplates();
if (!get('SELECT id FROM users LIMIT 1')) bootstrap();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/public', publicRoutes);
app.use('/api/files', requireAuth, express.static(UPLOAD_DIR));
app.use('/api', coreRoutes);
app.use('/api', reportRoutes);
app.use('/api', recruitRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built React app
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Server error: ' + err.message : err.message });
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`EPIL Recruitment Portal running on http://localhost:${PORT}`));
