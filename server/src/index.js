// Node.js entry (local / VPS). Cloudflare uses worker.js instead.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useNodeSqlite, exec } from './db.js';
import { useLocalDir } from './storage.js';
import { createApp, errorHandler } from './app.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(here, '..', 'data', 'recruitment.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
await useNodeSqlite(DB_PATH);
await exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
await useLocalDir(process.env.UPLOAD_DIR || path.join(here, '..', 'uploads'));

const app = createApp();

// Serve the built React app
const dist = path.join(here, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}
errorHandler(app);

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => console.log(`EPIL Recruitment Portal running on http://localhost:${PORT}`));
