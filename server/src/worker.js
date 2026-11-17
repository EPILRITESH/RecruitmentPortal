// Cloudflare Workers entry.
//   env.DB     -> D1 database
//   env.FILES  -> R2 bucket for resumes / invoices (optional – without it files are kept in D1)
//   React app  -> client/dist packed into static-bundle.js (npm run build:worker)
// Secrets: ANTHROPIC_API_KEY, JWT_SECRET (wrangler secret put ...)
import { env, waitUntil } from 'cloudflare:workers';
import { httpServerHandler } from 'cloudflare:node';
import { useD1 } from './db.js';
import { useR2, useD1Files } from './storage.js';
import { createApp, errorHandler, ensureReady } from './app.js';
import { setBackground } from './candidates.js';
import { runHourly } from './automation.js';
import STATIC from './static-bundle.js';

useD1(env.DB);
setBackground((p) => waitUntil(p.catch((e) => console.error('[background]', e.message))));
if (env.FILES) useR2(env.FILES);
else useD1Files(env.DB);

const app = createApp();

// Serve the React app: exact file, else index.html (single-page app routes like /tasks)
app.get(/^\/(?!api\/).*/, (req, res) => {
  const f = STATIC[req.path] || STATIC['/index.html'];
  res.setHeader('Content-Type', f.type);
  res.setHeader('Cache-Control', req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
  res.send(f.b64 ? Buffer.from(f.body, 'base64') : f.body);
});
errorHandler(app);
app.listen(3000);

const http = httpServerHandler({ port: 3000 });

export default {
  fetch: http.fetch.bind(http),
  // Cron trigger (wrangler.jsonc): interview reminders + daily task digest
  async scheduled(controller, environment, ctx) {
    ctx.waitUntil(ensureReady().then(runHourly).then((r) => console.log('[cron]', JSON.stringify(r))));
  },
};
