// Applies server/migrations/*.sql to the local SQLite file (same files wrangler applies to D1).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec, all, run, now } from './db.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrateNode() {
  await exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)');
  const done = new Set((await all('SELECT name FROM d1_migrations')).map((r) => r.name));
  // databases created before migrations existed already have the 0001 tables
  if (!done.size && (await all(`SELECT name FROM sqlite_master WHERE type='table' AND name='requirements'`)).length) {
    await run('INSERT INTO d1_migrations(name, applied_at) VALUES(?,?)', '0001_init.sql', now());
    done.add('0001_init.sql');
  }
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    await exec(fs.readFileSync(path.join(dir, f), 'utf8'));
    await run('INSERT INTO d1_migrations(name, applied_at) VALUES(?,?)', f, now());
    console.log('Applied migration', f);
  }
}
