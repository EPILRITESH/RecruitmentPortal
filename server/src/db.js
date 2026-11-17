// Async DB layer. Two drivers, same SQL:
//   - Cloudflare Workers: D1 binding `env.DB`
//   - Node.js (local / VPS): built-in node:sqlite file database
// Every query goes through all/get/run/batch so the rest of the code does not care which one runs.

let driver = null;

/** Called once at startup by the entry file (worker.js or index.js). */
export function useD1(d1) {
  driver = {
    kind: 'd1',
    async all(sql, params) { return (await d1.prepare(sql).bind(...params).all()).results || []; },
    async get(sql, params) { return (await d1.prepare(sql).bind(...params).first()) || undefined; },
    async run(sql, params) {
      const r = await d1.prepare(sql).bind(...params).run();
      return { changes: r.meta?.changes ?? 0, lastInsertRowid: r.meta?.last_row_id };
    },
    async exec(sqlText) { await d1.exec(sqlText.replace(/--[^\n]*\n/g, '\n').replace(/\s*\n\s*/g, ' ')); },
    async batch(list) { if (list.length) await d1.batch(list.map(([sql, params]) => d1.prepare(sql).bind(...params))); },
  };
}

export async function useNodeSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const conv = (r) => (r ? { ...r } : undefined);
  driver = {
    kind: 'node',
    raw: db,
    async all(sql, params) { return db.prepare(sql).all(...params).map(conv); },
    async get(sql, params) { return conv(db.prepare(sql).get(...params)); },
    async run(sql, params) { const r = db.prepare(sql).run(...params); return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) }; },
    async exec(sqlText) { db.exec(sqlText); },
    async batch(list) {
      db.exec('BEGIN');
      try { for (const [sql, params] of list) db.prepare(sql).run(...params); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}

const d = () => {
  if (!driver) throw new Error('Database not initialised');
  return driver;
};
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export const all = (sql, ...params) => d().all(sql, clean(params));
export const get = (sql, ...params) => d().get(sql, clean(params));
export const run = (sql, ...params) => d().run(sql, clean(params));
export const exec = (sqlText) => d().exec(sqlText);
/** Many writes in one round trip (D1 batch = one subrequest, atomic). list: [[sql, ...params], ...] */
export async function batch(list) {
  for (let i = 0; i < list.length; i += 80) await d().batch(list.slice(i, i + 80).map(([sql, ...params]) => [sql, clean(params)]));
}
export const dbKind = () => driver?.kind;

// D1 has no interactive transactions; steps are written in a safe order instead.
export async function tx(fn) { return fn(); }

// ---------------------------------------------------------------------------
// Time: everything is stored as India wall-clock time "YYYY-MM-DD HH:MM:SS".
// Workers always run in UTC, so we never rely on the machine time zone:
// a "wall" Date is a Date whose UTC fields hold the IST clock reading.
// ---------------------------------------------------------------------------
export const TZ_OFFSET_MIN = 330; // Asia/Kolkata
export const nowWall = () => new Date(Date.now() + TZ_OFFSET_MIN * 60000);
export function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}
export const now = () => fmt(nowWall());
export function parse(s) {
  if (!s) return null;
  let t = String(s).trim().replace(' ', 'T');
  if (t.length === 10) t += 'T00:00:00';
  if (t.length === 16) t += ':00';
  const dt = new Date(`${t.slice(0, 19)}Z`);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// ---------------------------------------------------------------------------
export async function setting(key, fallback = null) {
  const r = await get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
export async function setSetting(key, value) {
  await run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}

// Next sequential code like IN-166, continuing from imported FMS numbers
export async function nextCode(table, prefix, start) {
  const r = await get(`SELECT code FROM ${table} WHERE code GLOB ? ORDER BY CAST(substr(code, ?) AS INTEGER) DESC LIMIT 1`, `${prefix}-[0-9]*`, prefix.length + 2);
  const n = r ? parseInt(r.code.split('-')[1], 10) + 1 : start;
  return `${prefix}-${n}`;
}

export async function logActivity(entity_type, entity_id, action, detail, user_id) {
  await run('INSERT INTO activity(entity_type, entity_id, action, detail, user_id, created_at) VALUES(?,?,?,?,?,?)',
    entity_type, entity_id, action, detail ?? null, user_id ?? null, now());
}
