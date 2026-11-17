// Export the local Node database (after `npm run import:fms`) as SQL INSERTs for Cloudflare D1.
// Usage:  node src/export-d1.js > d1-data.sql
//         npx wrangler d1 execute epil-recruitment --remote --file d1-data.sql
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_PATH || path.join(here, '..', 'data', 'recruitment.db'));

// parents before children (foreign keys)
const TABLES = ['users', 'masters', 'steps', 'holidays', 'settings', 'templates', 'requirements', 'candidates', 'onboardings',
  'step_instances', 'activity', 'messages', 'portal_payments', 'ai_runs'];
const SKIP_SETTINGS = new Set(['jwt_secret']);

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (v instanceof Uint8Array) return `X'${Buffer.from(v).toString('hex')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out = [];
for (const t of [...TABLES].reverse()) out.push(`DELETE FROM ${t};`);
for (const t of TABLES) {
  const rows = db.prepare(`SELECT * FROM ${t}`).all();
  if (!rows.length) continue;
  const cols = Object.keys(rows[0]);
  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50).filter((r) => !(t === 'settings' && SKIP_SETTINGS.has(r.key)));
    if (!chunk.length) continue;
    out.push(`INSERT INTO ${t} (${cols.join(',')}) VALUES\n${chunk.map((r) => `(${cols.map((c) => lit(r[c])).join(',')})`).join(',\n')};`);
  }
}
process.stdout.write(out.join('\n') + '\n');
