// Attendance engine: biometric punches -> one row per employee per day.
// Works the same for every source (ZKTeco/eSSL ADMS push, API/webhook, Excel import, manual).
import { all, get, run, batch, now, parse, fmt } from '../db.js';

// ------------------------------------------------------------ HR settings with defaults
export const HR_DEFAULTS = {
  single_punch: 'MP',          // MP = missed punch (unpaid until regularised) | HD = half day
  late_penalty_count: '3',     // every N late marks = 0.5 day cut (0 = off)
  sandwich_leave: '0',         // weekly off / holiday between two absent days becomes unpaid
  pay_days_basis: 'calendar',  // calendar | 30 | 26
  weekly_off_paid: '1',
  holiday_paid: '1',
  basic_pct: '50',             // % of gross
  hra_pct: '40',               // % of basic
  pf_rate: '12', pf_employer_rate: '12', pf_ceiling: '15000',
  esic_rate: '0.75', esic_employer_rate: '3.25', esic_limit: '21000',
  pt_slabs: '0:0,12000:200',   // Gujarat: gross >= 12000 -> 200
  ot_multiplier: '2',          // 2 = double rate (Factories Act); 1 = single
  ot_basis: 'gross',           // gross | basic
  ot_on_off_day: '1',          // hours worked on weekly off / holiday count as OT
  ot_max_hours_month: '0',     // 0 = no cap
  emp_code_prefix: 'EMP',
};
export async function hrSettings() {
  const rows = await all(`SELECT key, value FROM settings WHERE key LIKE 'hr_%'`);
  const out = { ...HR_DEFAULTS };
  for (const r of rows) out[r.key.slice(3)] = r.value;
  return out;
}

// ------------------------------------------------------------ helpers
const toMin = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return h * 60 + (m || 0); };
export const dayList = (from, to) => {
  const out = []; const d = parse(from); const e = parse(to);
  while (d <= e) { out.push(fmt(d).slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
};
const addMin = (dateStr, minutes) => { const d = parse(dateStr); d.setUTCMinutes(d.getUTCMinutes() + minutes); return d; };
const diffMin = (a, b) => Math.round((parse(a) - parse(b)) / 60000);

export async function shiftsMap() {
  const rows = await all('SELECT * FROM shifts');
  const m = {};
  for (const s of rows) m[s.id] = s;
  return m;
}
export const DEFAULT_SHIFT = { id: 0, name: 'General', start_time: '09:00', end_time: '19:00', break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10, full_day_hours: 8, half_day_hours: 4, ot_after_minutes: 30, ot_round_minutes: 30, weekly_off: '0' };

// ------------------------------------------------------------ punch ingest
/** Save punches [{biometric_id, time, device, source}] (dupes ignored), then re-process affected days. */
export async function ingestPunches(list, { source = 'device', device = null } = {}) {
  const clean = [];
  for (const p of list) {
    const bio = String(p.biometric_id ?? p.pin ?? p.emp_code ?? '').trim();
    const t = p.time || p.punch_time || p.datetime;
    const d = t ? parse(String(t).replace('T', ' ').slice(0, 19)) : null;
    if (!bio || !d) continue;
    clean.push({ bio, time: fmt(d), device: p.device || device, direction: p.direction || null });
  }
  if (!clean.length) return { saved: 0, employees: 0 };
  const bios = [...new Set(clean.map((c) => c.bio))];
  const emps = {};
  for (let i = 0; i < bios.length; i += 90) {
    const chunk = bios.slice(i, i + 90);
    for (const e of await all(`SELECT id, biometric_id, emp_code FROM employees WHERE biometric_id IN (${chunk.map(() => '?').join(',')}) OR emp_code IN (${chunk.map(() => '?').join(',')})`, ...chunk, ...chunk)) {
      if (e.biometric_id) emps[e.biometric_id] = e.id;
      emps[e.emp_code] ||= e.id;
    }
  }
  const ts = now();
  await batch(clean.map((c) => [`INSERT INTO punches(biometric_id, employee_id, punch_time, device, source, direction, created_at) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(biometric_id, punch_time) DO NOTHING`, c.bio, emps[c.bio] ?? null, c.time, c.device, source, c.direction, ts]));
  // re-process each employee for the touched dates (and the day before, for night shifts)
  const touched = {};
  for (const c of clean) {
    const id = emps[c.bio]; if (!id) continue;
    const day = c.time.slice(0, 10);
    const prev = fmt(addMin(`${day} 00:00:00`, -1440)).slice(0, 10);
    (touched[id] ||= new Set()).add(day).add(prev);
  }
  for (const [id, days] of Object.entries(touched)) {
    const sorted = [...days].sort();
    await processAttendance({ employeeIds: [Number(id)], from: sorted[0], to: sorted[sorted.length - 1] });
  }
  return { saved: clean.length, employees: Object.keys(touched).length, unknown: bios.filter((b) => !emps[b]) };
}

// ------------------------------------------------------------ processing
/**
 * Build attendance rows for employees between from..to (inclusive). Manual rows are kept.
 * Returns number of rows written.
 */
export async function processAttendance({ employeeIds = null, from, to, company = null }) {
  const today = now().slice(0, 10);
  if (to > today) to = today;
  if (from > to) return 0;
  const S = await hrSettings();
  const shifts = await shiftsMap();
  const where = employeeIds ? `id IN (${employeeIds.map(() => '?').join(',')})` : `status <> 'Left' OR exit_date >= ?`;
  const params = employeeIds ? employeeIds : [from];
  let emps = await all(`SELECT id, joining_date, exit_date, shift_id, ot_allowed, company FROM employees WHERE ${where}`, ...params);
  if (company) emps = emps.filter((e) => e.company === company);
  if (!emps.length) return 0;
  if (emps.length > 40) { // D1 allows 100 bound parameters per query
    let n = 0;
    for (let i = 0; i < emps.length; i += 40) n += await processAttendance({ employeeIds: emps.slice(i, i + 40).map((e) => e.id), from, to });
    return n;
  }
  const ids = emps.map((e) => e.id);
  const inIds = `(${ids.map(() => '?').join(',')})`;

  const winFrom = `${fmt(addMin(`${from} 00:00:00`, -1440)).slice(0, 10)} 00:00:00`;
  const winTo = `${fmt(addMin(`${to} 00:00:00`, 2 * 1440)).slice(0, 10)} 00:00:00`;
  const punches = await all(`SELECT employee_id, punch_time FROM punches WHERE employee_id IN ${inIds} AND punch_time BETWEEN ? AND ? ORDER BY punch_time`, ...ids, winFrom, winTo);
  const holidays = new Set((await all('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', from, to)).map((h) => h.date));
  const leaves = await all(`SELECT employee_id, leave_code, from_date, to_date, half_day FROM leave_requests WHERE status='Approved' AND employee_id IN ${inIds} AND to_date >= ? AND from_date <= ?`, ...ids, from, to);
  const regs = await all(`SELECT employee_id, date, in_time, out_time FROM attendance_requests WHERE status='Approved' AND employee_id IN ${inIds} AND date BETWEEN ? AND ?`, ...ids, from, to);
  const manual = new Set((await all(`SELECT employee_id, date FROM attendance WHERE manual=1 AND employee_id IN ${inIds} AND date BETWEEN ? AND ?`, ...ids, from, to)).map((m) => `${m.employee_id}|${m.date}`));
  const leaveTypes = Object.fromEntries((await all('SELECT code, paid FROM leave_types')).map((l) => [l.code, l]));

  const byEmp = {};
  for (const p of punches) (byEmp[p.employee_id] ||= []).push(p.punch_time);
  for (const r of regs) {
    if (r.in_time) (byEmp[r.employee_id] ||= []).push(`${r.date} ${r.in_time.length === 5 ? `${r.in_time}:00` : r.in_time}`);
    if (r.out_time) (byEmp[r.employee_id] ||= []).push(`${r.date} ${r.out_time.length === 5 ? `${r.out_time}:00` : r.out_time}`);
  }
  for (const k of Object.keys(byEmp)) byEmp[k].sort();

  const days = dayList(from, to);
  const ts = now();
  const writes = [];
  for (const e of emps) {
    const sh = shifts[e.shift_id] || DEFAULT_SHIFT;
    const offs = String(sh.weekly_off ?? '0').split(',').filter((x) => x !== '').map(Number);
    const startM = toMin(sh.start_time); let endM = toMin(sh.end_time);
    if (endM <= startM) endM += 1440; // night shift
    const empPunches = byEmp[e.id] || [];
    for (const day of days) {
      if (manual.has(`${e.id}|${day}`)) continue;
      const row = { employee_id: e.id, date: day, first_in: null, last_out: null, punch_count: 0, work_minutes: 0, late_minutes: 0, early_minutes: 0, ot_minutes: 0, status: 'A', leave_code: null, remark: null };
      if ((e.joining_date && day < e.joining_date.slice(0, 10)) || (e.exit_date && day > e.exit_date.slice(0, 10))) {
        row.status = 'NA';
        writes.push(row); continue;
      }
      const shiftStart = addMin(`${day} 00:00:00`, startM);
      const shiftEnd = addMin(`${day} 00:00:00`, endM);
      const wFrom = fmt(addMin(fmt(shiftStart), -240));
      const wTo = fmt(addMin(fmt(shiftEnd), 360));
      const ps = empPunches.filter((t) => t >= wFrom && t <= wTo);
      // drop accidental double-taps within 2 minutes
      const uniq = ps.filter((t, i) => i === 0 || diffMin(t, ps[i - 1]) > 2);
      row.punch_count = uniq.length;
      const dow = parse(day).getUTCDay();
      const isHoliday = holidays.has(day);
      const isOff = offs.includes(dow);
      const lv = leaves.find((l) => l.employee_id === e.id && l.from_date <= day && l.to_date >= day);
      const halfLeave = lv && lv.half_day;
      if (uniq.length) row.first_in = uniq[0];
      if (uniq.length >= 2) {
        row.last_out = uniq[uniq.length - 1];
        const span = diffMin(row.last_out, row.first_in);
        row.work_minutes = Math.max(0, span - (span > 300 ? sh.break_minutes : 0));
      }
      const fullM = sh.full_day_hours * 60;
      const halfM = sh.half_day_hours * 60;
      if (!uniq.length) {
        if (isHoliday) row.status = 'H';
        else if (isOff) row.status = 'WO';
        else if (lv) { row.status = halfLeave ? 'A' : 'L'; row.leave_code = lv.leave_code; if (halfLeave) row.remark = 'Half-day leave, other half absent'; }
        else row.status = 'A';
      } else if (uniq.length === 1) {
        row.status = (isHoliday || isOff) ? (isHoliday ? 'H' : 'WO') : (S.single_punch === 'HD' ? 'HD' : 'MP');
        row.remark = 'Single punch – missed in/out';
        if (lv) row.leave_code = lv.leave_code;
      } else if (isHoliday || isOff) {
        row.status = isHoliday ? 'HP' : 'WOP';
        if (e.ot_allowed && S.ot_on_off_day === '1') row.ot_minutes = row.work_minutes;
      } else {
        row.status = row.work_minutes >= fullM ? 'P' : row.work_minutes >= halfM ? 'HD' : 'A';
        if (row.status === 'A') row.remark = `Short hours (${Math.round(row.work_minutes / 6) / 10} h)`;
        if (lv) { row.leave_code = lv.leave_code; if (!halfLeave && row.status !== 'P') row.status = 'L'; }
        const late = diffMin(row.first_in, fmt(shiftStart));
        if (late > sh.grace_minutes) row.late_minutes = late;
        const early = diffMin(fmt(shiftEnd), row.last_out);
        if (early > sh.early_grace_minutes) row.early_minutes = early;
        if (e.ot_allowed) {
          const after = diffMin(row.last_out, fmt(shiftEnd));
          if (after > sh.ot_after_minutes) row.ot_minutes = after;
        }
      }
      if (row.ot_minutes && sh.ot_round_minutes > 0) row.ot_minutes = Math.floor(row.ot_minutes / sh.ot_round_minutes) * sh.ot_round_minutes;
      if (row.leave_code && leaveTypes[row.leave_code] && !leaveTypes[row.leave_code].paid && row.status === 'L') row.remark = 'Leave without pay';
      writes.push(row);
    }
  }
  await batch(writes.map((r) => [`INSERT INTO attendance(employee_id, date, first_in, last_out, punch_count, work_minutes, late_minutes, early_minutes, ot_minutes, status, leave_code, remark, manual, updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,0,?)
    ON CONFLICT(employee_id, date) DO UPDATE SET first_in=excluded.first_in, last_out=excluded.last_out, punch_count=excluded.punch_count, work_minutes=excluded.work_minutes,
      late_minutes=excluded.late_minutes, early_minutes=excluded.early_minutes, ot_minutes=excluded.ot_minutes, status=excluded.status, leave_code=excluded.leave_code,
      remark=excluded.remark, updated_at=excluded.updated_at WHERE attendance.manual=0`,
  r.employee_id, r.date, r.first_in, r.last_out, r.punch_count, r.work_minutes, r.late_minutes, r.early_minutes, r.ot_minutes, r.status, r.leave_code, r.remark, ts]));
  return writes.length;
}

// ------------------------------------------------------------ ZKTeco / eSSL ADMS ("Cloud server") push protocol
/** Parse ATTLOG body lines: PIN \t YYYY-MM-DD HH:MM:SS \t status \t verify ... */
export function parseAttlog(body) {
  const out = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const pin = parts[0].trim();
    const time = parts[1].trim();
    if (!pin || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(time)) continue;
    const st = parts[2]?.trim();
    out.push({ biometric_id: pin, time, direction: st === '0' ? 'in' : st === '1' ? 'out' : null });
  }
  return out;
}

export async function deviceSeen(sn, ip) {
  let d = await get('SELECT * FROM devices WHERE serial_no=?', sn);
  if (!d) {
    await run(`INSERT INTO devices(name, serial_no, kind, active, last_seen, last_ip, created_at) VALUES(?,?, 'adms', 0, ?, ?, ?)`, `Device ${sn}`, sn, now(), ip || null, now());
    d = await get('SELECT * FROM devices WHERE serial_no=?', sn);
  } else {
    await run('UPDATE devices SET last_seen=?, last_ip=? WHERE id=?', now(), ip || null, d.id);
  }
  return d;
}
