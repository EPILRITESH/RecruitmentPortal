// Thin DB layer over SQLite (node:sqlite). Same SQL works on Cloudflare D1.
// Every query goes through all/get/run so swapping the driver (D1, MySQL) is one file.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(here, '..', 'data', 'recruitment.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

export const all = (sql, ...params) => db.prepare(sql).all(...clean(params)).map((r) => ({ ...r }));
export const get = (sql, ...params) => {
  const r = db.prepare(sql).get(...clean(params));
  return r ? { ...r } : undefined;
};
export const run = (sql, ...params) => db.prepare(sql).run(...clean(params));

export function tx(fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Local (IST) timestamp string "YYYY-MM-DD HH:MM:SS"
export function fmt(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const now = () => fmt(new Date());
export const parse = (s) => (s ? new Date(String(s).replace(' ', 'T')) : null);

export function setting(key, fallback = null) {
  const r = get('SELECT value FROM settings WHERE key = ?', key);
  return r ? r.value : fallback;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, String(value));
}

// Next sequential code like IN-166, continuing from imported FMS numbers
export function nextCode(table, prefix, start) {
  const r = get(`SELECT code FROM ${table} WHERE code LIKE ? ORDER BY CAST(substr(code, ?) AS INTEGER) DESC LIMIT 1`, `${prefix}-%`, prefix.length + 2);
  const n = r ? parseInt(r.code.split('-')[1], 10) + 1 : start;
  return `${prefix}-${n}`;
}

export function logActivity(entity_type, entity_id, action, detail, user_id) {
  run('INSERT INTO activity(entity_type, entity_id, action, detail, user_id, created_at) VALUES(?,?,?,?,?,?)',
    entity_type, entity_id, action, detail ?? null, user_id ?? null, now());
}
