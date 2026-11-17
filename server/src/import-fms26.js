// One-time migration: FMS-26 Google Sheet (downloaded as .xlsx) -> portal database.
// Usage:  npm run import:fms -- "/path/to/FMS-26 RECRUITMENT 2026.xlsx" [--reset] [--skip-backlog-before=YYYY-MM-DD]
// Reads INWARD FMS, OUTWARD FMS, ONBOARDING FMS, Portal Payment and Holidays tabs and
// rebuilds every record with its step history (planned / actual / result / delay).
process.env.TZ = process.env.TZ || 'Asia/Kolkata';
import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { useNodeSqlite, exec, all, get, run, now, parse, tx } from './db.js';
import { seedSteps, getSteps } from './workflow.js';
import { bootstrap } from './seed.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const reset = process.argv.includes('--reset');
// --skip-backlog-before=2026-10-01 : old pending steps planned before this date are marked "skipped"
const skipBefore = (process.argv.find((a) => a.startsWith('--skip-backlog-before=')) || '').split('=')[1] || null;
if (!file) {
  console.error('Usage: npm run import:fms -- "/path/to/FMS-26.xlsx" [--reset]');
  process.exit(1);
}

// ---------- cell helpers ----------
function val(v) {
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('error' in v) return null;
    if ('result' in v) return val(v.result);
    if (v.richText) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.hyperlink && /^https?:/.test(v.hyperlink) ? v.hyperlink : v.text;
    if ('hyperlink' in v) return v.hyperlink;
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    return s === '' || s.startsWith('#') ? null : s;
  }
  return v;
}
const p2 = (n) => String(n).padStart(2, '0');
// Sheet dates are IST wall-clock values; exceljs exposes them as UTC fields
// Sheet typos (year 206, #NUM!) become empty instead of breaking delay maths
function d(v) {
  const out = dRaw(v);
  if (!out) return null;
  const y = Number(out.slice(0, 4));
  return y >= 2000 && y <= 2100 && !out.includes('NaN') ? out : null;
}
function dRaw(v) {
  v = val(v);
  if (!v) return null;
  if (v instanceof Date) {
    if (v.getUTCFullYear() < 1900) return null; // 30/12/1899 blank-date bug
    return `${v.getUTCFullYear()}-${p2(v.getUTCMonth() + 1)}-${p2(v.getUTCDate())} ${p2(v.getUTCHours())}:${p2(v.getUTCMinutes())}:${p2(v.getUTCSeconds())}`;
  }
  const m = String(v).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return `${m[3]}-${p2(m[2])}-${p2(m[1])} ${p2(m[4] || 0)}:${m[5] || '00'}:${m[6] || '00'}`;
  return null;
}
const s = (v) => { v = val(v); return v == null ? null : v instanceof Date ? d(v) : String(v).trim(); };
const up = (v) => (s(v) || '').toUpperCase();
const num = (v) => { v = val(v); const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && String(v ?? '').match(/\d/) ? n : null; };
const mobile = (v) => String(val(v) ?? '').replace(/\.0$/, '').replace(/\D/g, '').slice(-10);

function rowsOf(ws, startRow) {
  const out = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n < startRow) return;
    const vals = row.values; // 1-indexed
    out.push((i) => vals[i + 1]); // accessor with 0-based column index (matches header listing)
  });
  return out;
}

// ---------- step writer ----------
const delayH = (planned, actual) => (planned && actual ? Math.max(0, Math.round(((parse(actual) - parse(planned)) / 36e5) * 10) / 10) : null);
async function putStep(entity_type, entity_id, code, { planned, actual, result, remark, state }) {
  await run(`INSERT INTO step_instances(entity_type, entity_id, step_code, planned_at, actual_at, state, result, remark, delay_hours, created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entity_type, entity_id, step_code) DO NOTHING`,
    entity_type, entity_id, code, planned, actual, state, result, remark ?? null, state === 'done' ? delayH(planned, actual) : null, actual || planned || now());
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dbFile = process.env.DB_PATH || path.join(here, '..', 'data', 'recruitment.db');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  await useNodeSqlite(dbFile);
  await exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  console.log('Reading', file);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheet = (name) => wb.worksheets.find((w) => w.name.trim().toUpperCase() === name.toUpperCase());

  await seedSteps();
  if (!await get('SELECT id FROM users LIMIT 1')) await bootstrap();
  await getSteps();

  const existing = (await get('SELECT COUNT(*) n FROM candidates')).n + (await get('SELECT COUNT(*) n FROM requirements')).n;
  if (existing && !reset) {
    console.error(`Database already has ${existing} records. Re-run with --reset to wipe recruitment data and import again.`);
    process.exit(1);
  }

  await exec('BEGIN');
  await tx(async () => {
    if (reset) {
      for (const t of ['step_instances', 'activity', 'messages', 'onboardings', 'candidates', 'requirements', 'portal_payments', 'ai_runs']) await run(`DELETE FROM ${t}`);
      await run(`DELETE FROM sqlite_sequence WHERE name IN ('step_instances','activity','messages','onboardings','candidates','requirements','portal_payments','ai_runs')`);
    }

    // ================= INWARD =================
    const reqBySr = new Map();
    const inw = sheet('INWARD FMS');
    let nIn = 0;
    for (const c of rowsOf(inw, 8)) {
      const designation = s(c(5));
      if (!designation) continue;
      const sr = num(c(1));
      const code = s(c(19)) || `IN-${sr}`;
      const created = d(c(0)) || now();
      const st = up(c(23));
      const x = await run(`INSERT INTO requirements(code, request_date, company, designation, salary_range, openings, requirement_by, status, jd_status, created_at)
                     VALUES(?,?,?,?,?,1,?,?,?,?)`,
        code, (d(c(2)) || created).slice(0, 10), s(c(4)) || '-', designation, s(c(6)), (s(c(3)) || '-').toUpperCase().replace(/\s+/g, ' ').trim(),
        st === 'HOLD' ? 'On Hold' : 'Open', 'Approved', created);
      const id = Number(x.lastInsertRowid);
      reqBySr.set(sr, id);
      const map = [['S01', 7, 'Done'], ['S02', 11, 'Posted'], ['S03', 15, 'Verified']];
      let open = st !== 'HOLD';
      for (const [code2, col, okLabel] of map) {
        const planned = d(c(col)), actual = d(c(col + 1));
        if (actual) await putStep('requirement', id, code2, { planned, actual, result: okLabel, state: 'done' });
        else if (open) { await putStep('requirement', id, code2, { planned: planned || created, state: 'pending' }); open = false; }
      }
      nIn++;
    }
    console.log(`Inward: ${nIn} requirements`);

    // ================= OUTWARD =================
    const out = sheet('OUTWARD FMS');
    let nOut = 0;
    const selectedByName = new Map();
    const MAP = [
      { code: 'S04', col: 10, res: (r) => ({ ACCEPTED: 'Accepted', SELECTED: 'Accepted', REJECTED: 'Rejected' })[r] },
      { code: 'S05', col: 14, res: (r) => ({ INTERESTED: 'Interested', 'NOT INTERESTED': 'Not Interested' })[r] },
      { code: 'S06', col: 18, res: (r) => ({ 'FORM FILLED': 'Form Filled', 'FORM NOT FILLED': 'Not Filled' })[r] },
      { code: 'S07', col: 22, res: (r, c) => ({ COME: 'Came', 'NOT COME': 'Not Came', 'POSITION CLOSE': 'Not Came' })[up(c(25))] || (r === 'DONE' ? 'Came' : undefined), remark: (c) => s(c(25)) },
      { code: 'S08', col: 27, res: (r) => ({ SELECTED: 'Selected', REJECTED: 'Rejected', HOLD: 'Hold', 'FUTURE HOLD': 'Future Hold' })[r] },
      { code: 'S09', col: 32, res: (r) => ({ SELECTED: 'Select', REJECTED: 'Reject' })[r] },
      { code: 'S10', col: 36, res: (r) => ({ SELECTED: 'Selected', REJECTED: 'Rejected' })[r] },
      { code: 'S11', col: 40, res: (r) => ({ SELECTED: 'Selected', REJECTED: 'Rejected' })[r] },
      { code: 'S12', col: 44, res: (r) => (r ? 'Sent' : undefined) },
      { code: 'S13', col: 49, res: (r) => (r ? 'Verified' : undefined) },
    ];
    const steps = Object.fromEntries((await getSteps('outward')).map((x) => [x.code, x]));
    for (const c of rowsOf(out, 8)) {
      const name = s(c(3));
      if (!name) continue;
      const code = s(c(61)) || `OUT-${num(c(2))}`;
      const created = d(c(0)) || now();
      const reqId = reqBySr.get(num(c(1))) || null;
      const x = await run(`INSERT INTO candidates(code, requirement_id, name, mobile, source, consultancy_email, resume_url, joining_date, status, stage, apply_token, created_at)
                     VALUES(?,?,?,?,?,?,?,?, 'Active', 'Screening', ?, ?) ON CONFLICT(code) DO NOTHING`,
        code, reqId, name.replace(/\s+/g, ' '), mobile(c(6)), up(c(4)) || 'OTHER', s(c(5)), s(c(7)), (d(c(48)) || '').slice(0, 10) || null,
        Math.random().toString(36).slice(2, 12) + nOut, created);
      if (!x.changes) continue;
      const id = Number(x.lastInsertRowid);
      let status = 'Active', stage = 'Screening', pendingAdded = false, lastDone = null;
      let expected = 'S04';
      for (const m of MAP) {
        const planned = d(c(m.col)), actual = d(c(m.col + 1));
        const raw = up(c(m.col + 2));
        const result = m.res(raw, c);
        if (actual && result) {
          await putStep('candidate', id, m.code, { planned, actual, result, remark: m.remark?.(c), state: 'done' });
          lastDone = { code: m.code, result, actual };
          const opt = steps[m.code].options.find((o) => o.value === result);
          if (opt?.outcome === 'reject') { status = 'Rejected'; stage = `Rejected at ${steps[m.code].short_name}`; }
          if (opt?.outcome === 'drop') { status = 'Dropped'; stage = `Dropped at ${steps[m.code].short_name}`; }
          if (opt?.outcome === 'future_hold') { status = 'Future Hold'; stage = 'Future Hold'; }
          if (opt?.outcome === 'select') { status = 'Selected'; stage = 'Selected'; }
          if (status !== 'Active' && status !== 'Selected') break;
          expected = opt?.next || null;
        } else if (!pendingAdded && status !== 'Rejected' && status !== 'Dropped' && status !== 'Future Hold') {
          // first open step after the last done one => pending (only if it is the logical next step)
          const isNext = !lastDone || expected === m.code || (!expected && !steps[m.code].optional);
          if (isNext && (planned || !lastDone)) {
            await putStep('candidate', id, m.code, { planned: planned || created, state: 'pending' });
            stage = steps[m.code].short_name;
            pendingAdded = true;
          }
        }
      }
      await run('UPDATE candidates SET status=?, stage=? WHERE id=?', status, stage, id);
      if (status === 'Selected') selectedByName.set(name.toUpperCase().replace(/\s+/g, ' ').trim(), id);
      nOut++;
    }
    console.log(`Outward: ${nOut} candidates`);

    // ================= ONBOARDING =================
    const onbWs = sheet('ONBOARDING FMS');
    let nOnb = 0, unmatched = 0;
    const OMAP = [
      ['S14', 8, 'Done'], ['S15', 12, 'Joined'], ['S18', 16, 'Done'], ['S16', 20, 'Done'], ['S17', 20, 'Done'],
      ['S19', 24, 'Working'], ['S20', 28, 'Filled'], ['S21', 32, 'Done'], ['S22', 36, 'Paid'],
      ['S25', 43, null], ['S23', 47, null], ['S24', 51, null], ['S26', 55, 'Verified'],
    ];
    for (const c of rowsOf(onbWs, 7)) {
      const name = s(c(1));
      if (!name) continue;
      const key = name.toUpperCase().replace(/\s+/g, ' ').trim();
      let candId = selectedByName.get(key);
      if (!candId) {
        candId = (await get(`SELECT id FROM candidates WHERE upper(name)=? ORDER BY id DESC`, key))?.id;
      }
      if (!candId) {
        // onboarding row without an outward row: create the candidate so history is not lost
        const req = await get('SELECT id FROM requirements WHERE upper(designation)=upper(?) AND upper(company)=upper(?) ORDER BY id DESC', s(c(3)) || '', s(c(4)) || '');
        const x = await run(`INSERT INTO candidates(code, requirement_id, name, mobile, source, status, stage, created_at) VALUES(?,?,?,?,?, 'Selected', 'Selected', ?)`,
          `OUT-X${nOnb}`, req?.id || null, name, '', up(c(2)) || 'OTHER', d(c(0)) || now());
        candId = Number(x.lastInsertRowid);
        unmatched++;
      }
      if (await get('SELECT id FROM onboardings WHERE candidate_id=?', candId)) continue;
      const cand = await get('SELECT joining_date FROM candidates WHERE id=?', candId);
      const joining = cand.joining_date || (d(c(59)) || d(c(0)) || '').slice(0, 10) || null;
      const pay = up(c(39));
      const amount = num(c(40));
      const staff = up(c(42));
      const x = await run(`INSERT INTO onboardings(code, candidate_id, joining_date, checklist, agency_payment, status, created_at) VALUES(?,?,?, '{}', ?, 'Pre-Onboarding', ?)`,
        s(c(61)) || `ONB-${nOnb + 1}`, candId, joining, amount, d(c(0)) || now());
      const oid = Number(x.lastInsertRowid);
      let left = staff === 'LEFT';
      const results = {};
      for (const [code, col, okLabel] of OMAP) {
        const planned = d(c(col));
        let actual = d(c(col + 1));
        let raw = up(c(col + 2));
        // 30/60/90 checks were often marked Yes/No without stamping the actual date
        if (!actual && okLabel === null && raw) actual = planned;
        let result = okLabel;
        if (okLabel === null) result = raw.startsWith('Y') ? 'Working' : raw.startsWith('N') ? 'Left' : null;
        if (code === 'S22') result = pay === 'DONE' ? 'Paid' : pay === 'LEFT' ? 'Not Applicable' : actual ? 'Paid' : null;
        if (actual && result) {
          await putStep('onboarding', oid, code, { planned, actual, result, state: 'done', remark: code === 'S22' && amount ? `₹${amount}` : null });
          results[code] = result;
          if (result === 'Left') left = true;
        } else {
          await putStep('onboarding', oid, code, { planned: planned || joining || d(c(0)) || now(), state: left && code !== 'S22' && code !== 'S26' ? 'cancelled' : 'pending' });
        }
      }
      let status = 'Pre-Onboarding';
      if (results.S15) status = 'Joined';
      if (results.S25 === 'Working') status = 'Retained 90';
      if (left) status = 'Left';
      await run('UPDATE onboardings SET status=? WHERE id=?', status, oid);
      if (left) await run(`UPDATE step_instances SET state='cancelled' WHERE entity_type='onboarding' AND entity_id=? AND state='pending' AND step_code NOT IN ('S22','S26')`, oid);
      await run('UPDATE candidates SET status=? WHERE id=?', status === 'Left' ? 'Left' : status === 'Pre-Onboarding' ? 'Selected' : 'Joined', candId);
      nOnb++;
    }
    console.log(`Onboarding: ${nOnb} joinees (${unmatched} created without outward match)`);

    // requirement filled / closed
    await run(`UPDATE requirements SET filled = (SELECT COUNT(*) FROM candidates c JOIN onboardings o ON o.candidate_id=c.id WHERE c.requirement_id=requirements.id AND o.status IN ('Joined','Retained 90','Left'))`);
    await run(`UPDATE requirements SET status='Closed', closed_at=COALESCE(closed_at, created_at) WHERE status='Open' AND (filled >= openings OR EXISTS(SELECT 1 FROM candidates c WHERE c.requirement_id=requirements.id AND c.status IN ('Selected','Joined','Left')))
         AND NOT EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='requirement' AND si.entity_id=requirements.id AND si.state='pending')`);

    // ================= PAYMENTS =================
    const pp = sheet('Portal Payment');
    let nPay = 0;
    if (pp) {
      for (const c of rowsOf(pp, 2)) {
        const platform = up(c(2));
        const amount = num(c(5));
        if (!platform || !amount) continue;
        await run('INSERT INTO portal_payments(platform, post_name, posted_date, closed_date, amount, invoice, created_at) VALUES(?,?,?,?,?,?,?)',
          platform, s(c(1)), (d(c(3)) || '').slice(0, 10) || null, (d(c(4)) || '').slice(0, 10) || null, amount, s(c(6)), d(c(0)) || now());
        nPay++;
      }
    }
    console.log(`Portal payments: ${nPay}`);

    // ================= HOLIDAYS =================
    const hol = sheet('Holidays');
    if (hol) {
      for (const c of rowsOf(hol, 1)) {
        for (let i = 0; i < 6; i++) {
          const v = val(c(i));
          if (v instanceof Date) await run('INSERT INTO holidays(date,name) VALUES(?,?) ON CONFLICT DO NOTHING', d(v).slice(0, 10), s(c(i + 1)) || 'Holiday');
        }
      }
    }

    // masters from data
    for (const r of await all(`SELECT DISTINCT source, consultancy_email FROM candidates WHERE source IS NOT NULL`)) {
      await run(`INSERT INTO masters(type,name,email) VALUES('source',?,?) ON CONFLICT(type,name) DO NOTHING`, r.source, r.consultancy_email);
    }
    for (const r of await all(`SELECT DISTINCT upper(trim(designation)) d FROM requirements`)) await run(`INSERT INTO masters(type,name) VALUES('designation',?) ON CONFLICT DO NOTHING`, r.d);
    for (const r of await all(`SELECT DISTINCT requirement_by d FROM requirements`)) await run(`INSERT INTO masters(type,name) VALUES('requester',?) ON CONFLICT DO NOTHING`, r.d);
  });

  await exec('COMMIT');
  if (skipBefore) {
    const r = await run(`UPDATE step_instances SET state='skipped', remark='Old backlog skipped at import' WHERE state='pending' AND planned_at < ?`, skipBefore);
    console.log(`Skipped ${r.changes} old pending steps planned before ${skipBefore}`);
  }
  console.log('Pending tasks created:', (await get(`SELECT COUNT(*) n FROM step_instances WHERE state='pending'`)).n);
  console.log('Import complete ✔');
}

main().catch((e) => { console.error(e); process.exit(1); });
