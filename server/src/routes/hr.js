// HR & Payroll API: employees, shifts, devices, attendance, leave, payroll, self-service (/me)
import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, now, setting, setSetting, logActivity } from '../db.js';
import { requireAuth, requireRole, hashPassword } from '../auth.js';
import { hrSettings, HR_DEFAULTS, processAttendance, ingestPunches, dayList } from '../hr/attendance.js';
import { balances, applyLeave, decideLeave, cancelLeave, seedLeaveTypes } from '../hr/leave.js';
import { generatePayroll, ADJUSTMENT_KINDS, inWords } from '../hr/payroll.js';
import { runAutomations } from '../automation.js';

const r = Router();
r.use(requireAuth);
const HR = requireRole('hr', 'accounts');
const err = (status, message) => Object.assign(new Error(message), { status });
const monthBounds = (m) => { const [y, mo] = m.split('-').map(Number); return [`${m}-01`, `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, '0')}`]; };

export async function seedHR() {
  await seedLeaveTypes();
  if (!(await get('SELECT id FROM shifts LIMIT 1'))) {
    await run(`INSERT INTO shifts(name,start_time,end_time,break_minutes,grace_minutes,full_day_hours,half_day_hours,weekly_off) VALUES('General (9–7)','09:00','19:00',60,10,8,4,'0')`);
    await run(`INSERT INTO shifts(name,start_time,end_time,break_minutes,grace_minutes,full_day_hours,half_day_hours,weekly_off) VALUES('Night (8 PM–8 AM)','20:00','08:00',60,10,10,5,'0')`);
  }
  if (!(await setting('attendance_token'))) await setSetting('attendance_token', crypto.randomBytes(12).toString('hex'));
}

async function nextEmpCode() {
  const S = await hrSettings();
  const prefix = S.emp_code_prefix || 'EMP';
  const rows = await all('SELECT emp_code FROM employees WHERE emp_code LIKE ?', `${prefix}%`);
  const max = rows.reduce((m, x) => Math.max(m, Number(String(x.emp_code).slice(prefix.length).replace(/\D/g, '')) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

const EMP_COLS = ['emp_code', 'name', 'mobile', 'email', 'gender', 'dob', 'company', 'department', 'designation', 'location', 'joining_date', 'exit_date', 'status', 'employment_type',
  'shift_id', 'biometric_id', 'manager_user_id', 'salary_type', 'gross_salary', 'ot_allowed', 'pf_applicable', 'esic_applicable', 'pt_applicable',
  'bank_name', 'account_no', 'ifsc', 'pan', 'aadhaar', 'uan', 'esic_no', 'address', 'candidate_id'];
const NUM_COLS = new Set(['shift_id', 'manager_user_id', 'gross_salary', 'ot_allowed', 'pf_applicable', 'esic_applicable', 'pt_applicable', 'candidate_id']);
const val = (k, v) => (v === '' || v === undefined ? null : NUM_COLS.has(k) ? (v === null ? null : Number(String(v).replace(/[^\d.-]/g, '')) || 0) : String(v).trim());

export async function createEmployee(b, user) {
  if (!b.name) throw err(400, 'Name is required');
  const code = b.emp_code ? String(b.emp_code).trim() : await nextEmpCode();
  if (await get('SELECT id FROM employees WHERE emp_code=?', code)) throw err(409, `Employee code ${code} already exists`);
  const defShift = await get('SELECT id FROM shifts WHERE active=1 ORDER BY id LIMIT 1');
  const data = { ...b, emp_code: code, status: b.status || 'Active', salary_type: b.salary_type || 'monthly', gross_salary: b.gross_salary ?? 0, shift_id: b.shift_id || defShift?.id || null, biometric_id: b.biometric_id || code.replace(/\D/g, '').replace(/^0+/, '') || code };
  const cols = EMP_COLS.filter((k) => data[k] !== undefined);
  const x = await run(`INSERT INTO employees(${cols.join(',')}, created_at) VALUES(${cols.map(() => '?').join(',')}, ?)`, ...cols.map((k) => val(k, data[k])), now());
  const id = Number(x.lastInsertRowid);
  await logActivity('employee', id, 'Employee created', code, user?.id);
  return { id, emp_code: code };
}

/** Called when a recruitment candidate joins (Step 15 = Joined) */
export async function createEmployeeFromCandidate(candidate_id) {
  if (await get('SELECT id FROM employees WHERE candidate_id=?', candidate_id)) return null;
  const c = await get(`SELECT c.*, r.designation, r.company, r.department, r.location AS job_location, o.joining_date AS onb_join FROM candidates c
    LEFT JOIN requirements r ON r.id=c.requirement_id LEFT JOIN onboardings o ON o.candidate_id=c.id WHERE c.id=?`, candidate_id);
  if (!c) return null;
  const salary = Number(String(c.offered_salary || '').replace(/[^\d.]/g, '')) || 0;
  return createEmployee({ name: c.name, mobile: c.mobile, email: c.email, designation: c.designation, company: c.company, department: c.department, location: c.job_location,
    joining_date: (c.onb_join || c.joining_date || now()).slice(0, 10), gross_salary: salary, candidate_id }, null);
}

// ================================================================ employees
r.get('/hr/employees', HR, async (req, res) => {
  const { status = 'Active', q, company, department } = req.query;
  const where = ['1=1']; const p = [];
  if (status) { where.push('e.status=?'); p.push(status); }
  if (company) { where.push('e.company=?'); p.push(company); }
  if (department) { where.push('e.department=?'); p.push(department); }
  if (q) { where.push('(e.name LIKE ? OR e.emp_code LIKE ? OR e.mobile LIKE ? OR e.biometric_id=?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`, q); }
  res.json(await all(`SELECT e.*, s.name AS shift_name, u.email AS login, a.status AS today FROM employees e LEFT JOIN shifts s ON s.id=e.shift_id
    LEFT JOIN users u ON u.id=e.user_id LEFT JOIN attendance a ON a.employee_id=e.id AND a.date=? WHERE ${where.join(' AND ')} ORDER BY e.emp_code LIMIT 2000`, now().slice(0, 10), ...p));
});
r.get('/hr/summary', HR, async (req, res) => {
  const today = now().slice(0, 10);
  const head = await all(`SELECT company, department, COUNT(*) n FROM employees WHERE status <> 'Left' GROUP BY company, department ORDER BY company, department`);
  const todayAtt = await all(`SELECT a.status, COUNT(*) n FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date=? AND e.status <> 'Left' GROUP BY a.status`, today);
  const late = (await get('SELECT COUNT(*) n FROM attendance WHERE date=? AND late_minutes>0', today)).n;
  const pendingLeaves = (await get(`SELECT COUNT(*) n FROM leave_requests WHERE status='Pending'`)).n;
  const pendingReq = (await get(`SELECT COUNT(*) n FROM attendance_requests WHERE status='Pending'`)).n;
  const total = (await get(`SELECT COUNT(*) n FROM employees WHERE status <> 'Left'`)).n;
  const joined = (await get('SELECT COUNT(*) n FROM employees WHERE joining_date >= ?', `${today.slice(0, 7)}-01`)).n;
  const left = (await get('SELECT COUNT(*) n FROM employees WHERE exit_date >= ?', `${today.slice(0, 7)}-01`)).n;
  const unknown = (await get('SELECT COUNT(DISTINCT biometric_id) n FROM punches WHERE employee_id IS NULL')).n;
  const devices = await all('SELECT id, name, serial_no, active, last_seen, punches FROM devices ORDER BY id');
  res.json({ total, joined, left, head, today: todayAtt, late, pendingLeaves, pendingReq, unknown, devices });
});
r.get('/hr/employees/:id', HR, async (req, res) => {
  const e = await get('SELECT e.*, s.name AS shift_name, u.email AS login FROM employees e LEFT JOIN shifts s ON s.id=e.shift_id LEFT JOIN users u ON u.id=e.user_id WHERE e.id=?', req.params.id);
  if (!e) throw err(404, 'Employee not found');
  res.json({ employee: e, balances: await balances(e.id), leaves: await all('SELECT * FROM leave_requests WHERE employee_id=? ORDER BY id DESC LIMIT 50', e.id),
    payslips: await all('SELECT id, month, gross, deductions, net, paid_days, published FROM payslips WHERE employee_id=? ORDER BY month DESC', e.id),
    adjustments: await all('SELECT * FROM leave_adjustments WHERE employee_id=? ORDER BY id DESC', e.id) });
});
r.post('/hr/employees', HR, async (req, res) => res.json(await createEmployee(req.body || {}, req.user)));
r.put('/hr/employees/:id', HR, async (req, res) => {
  const b = req.body || {};
  const cols = EMP_COLS.filter((k) => k in b);
  if (b.emp_code && (await get('SELECT id FROM employees WHERE emp_code=? AND id<>?', b.emp_code, req.params.id))) throw err(409, 'Employee code already used');
  if (cols.length) await run(`UPDATE employees SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => val(k, b[k])), req.params.id);
  if (b.status === 'Left' && !b.exit_date) await run('UPDATE employees SET exit_date=COALESCE(exit_date, ?) WHERE id=?', now().slice(0, 10), req.params.id);
  if ('biometric_id' in b) await run('UPDATE punches SET employee_id=? WHERE biometric_id=? AND employee_id IS NULL', req.params.id, b.biometric_id);
  await logActivity('employee', Number(req.params.id), 'Employee updated', cols.join(', '), req.user.id);
  res.json({ ok: true });
});
// Excel / CSV import (batches of up to 50 rows). Existing emp_code -> update.
r.post('/hr/employees/import', HR, async (req, res) => {
  const rows = (req.body?.rows || []).slice(0, 50);
  const out = { created: 0, updated: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const ex = row.emp_code ? await get('SELECT id FROM employees WHERE emp_code=?', String(row.emp_code).trim()) : null;
      if (ex) {
        const cols = EMP_COLS.filter((k) => row[k] !== undefined && row[k] !== '' && k !== 'emp_code');
        if (cols.length) await run(`UPDATE employees SET ${cols.map((k) => `${k}=?`).join(',')} WHERE id=?`, ...cols.map((k) => val(k, row[k])), ex.id);
        out.updated++;
      } else { await createEmployee(row, req.user); out.created++; }
    } catch (e) { out.errors.push({ row: i + 1, error: e.message }); }
  }
  res.json(out);
});
// Self-service login for an employee (login with mobile number or email)
r.post('/hr/employees/:id/login', HR, async (req, res) => {
  const e = await get('SELECT * FROM employees WHERE id=?', req.params.id);
  if (!e) throw err(404, 'Employee not found');
  const password = req.body?.password || `${String(e.mobile || e.emp_code).slice(-4)}@${crypto.randomInt(100, 999)}`;
  if (e.user_id) {
    await run('UPDATE users SET password_hash=?, active=1 WHERE id=?', hashPassword(password), e.user_id);
  } else {
    const email = (e.email || `${e.emp_code.toLowerCase()}@epil.local`).toLowerCase();
    const existing = await get('SELECT id FROM users WHERE lower(email)=?', email);
    const uid = existing ? existing.id : Number((await run(`INSERT INTO users(name,email,phone,role,password_hash,created_at) VALUES(?,?,?, 'employee', ?, ?)`, e.name, email, e.mobile, hashPassword(password), now())).lastInsertRowid);
    if (existing) await run('UPDATE users SET password_hash=?, phone=COALESCE(phone, ?) WHERE id=?', hashPassword(password), e.mobile, uid);
    await run('UPDATE employees SET user_id=? WHERE id=?', uid, e.id);
  }
  const u = await get('SELECT email, phone FROM users WHERE id=(SELECT user_id FROM employees WHERE id=?)', e.id);
  res.json({ login: u.phone || u.email, email: u.email, password });
});
r.post('/hr/employees/:id/leave-adjust', HR, async (req, res) => {
  const { leave_code, days, year, note } = req.body || {};
  if (!leave_code || !Number(days)) throw err(400, 'Leave type and days required');
  await run('INSERT INTO leave_adjustments(employee_id, leave_code, year, days, note, created_by, created_at) VALUES(?,?,?,?,?,?,?)',
    req.params.id, leave_code, Number(year) || Number(now().slice(0, 4)), Number(days), note || null, req.user.id, now());
  res.json({ ok: true });
});

// ================================================================ shifts & HR settings
r.get('/hr/shifts', async (req, res) => res.json(await all('SELECT * FROM shifts ORDER BY id')));
r.post('/hr/shifts', HR, async (req, res) => {
  const b = req.body || {};
  const cols = ['name', 'start_time', 'end_time', 'break_minutes', 'grace_minutes', 'early_grace_minutes', 'full_day_hours', 'half_day_hours', 'ot_after_minutes', 'ot_round_minutes', 'weekly_off', 'active'];
  if (b.id) await run(`UPDATE shifts SET ${cols.filter((c) => c in b).map((c) => `${c}=?`).join(',')} WHERE id=?`, ...cols.filter((c) => c in b).map((c) => b[c]), b.id);
  else await run(`INSERT INTO shifts(${cols.filter((c) => c in b).join(',')}) VALUES(${cols.filter((c) => c in b).map(() => '?').join(',')})`, ...cols.filter((c) => c in b).map((c) => b[c]));
  res.json({ ok: true });
});
r.get('/hr/settings', HR, async (req, res) => {
  const base = await setting('public_url', '');
  res.json({ settings: await hrSettings(), defaults: HR_DEFAULTS, leave_types: await all('SELECT * FROM leave_types ORDER BY code'),
    punch_url: `${base}/api/public/punch/${await setting('attendance_token', '')}`, adms_host: base.replace(/^https?:\/\//, ''), adjustment_kinds: ADJUSTMENT_KINDS });
});
r.put('/hr/settings', requireRole(), async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) if (k in HR_DEFAULTS) await setSetting(`hr_${k}`, v ?? '');
  res.json({ ok: true });
});
r.post('/hr/leave-types', requireRole(), async (req, res) => {
  const t = req.body || {};
  if (!t.code || !t.name) throw err(400, 'Code and name required');
  await run(`INSERT INTO leave_types(code,name,paid,annual_quota,accrual,carry_forward_max,allow_half_day,allow_negative,active) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name, paid=excluded.paid, annual_quota=excluded.annual_quota, accrual=excluded.accrual,
    carry_forward_max=excluded.carry_forward_max, allow_half_day=excluded.allow_half_day, allow_negative=excluded.allow_negative, active=excluded.active`,
  t.code.toUpperCase(), t.name, t.paid ? 1 : 0, Number(t.annual_quota) || 0, t.accrual || 'yearly', Number(t.carry_forward_max) || 0, t.allow_half_day ? 1 : 0, t.allow_negative ? 1 : 0, t.active === 0 ? 0 : 1);
  res.json({ ok: true });
});

// ================================================================ devices & punches
r.get('/hr/devices', HR, async (req, res) => res.json(await all('SELECT * FROM devices ORDER BY id')));
r.put('/hr/devices/:id', HR, async (req, res) => {
  const { name, location, active } = req.body || {};
  await run('UPDATE devices SET name=COALESCE(?,name), location=COALESCE(?,location), active=COALESCE(?,active) WHERE id=?', name, location, active, req.params.id);
  res.json({ ok: true });
});
r.post('/hr/devices', HR, async (req, res) => {
  const { name, serial_no, location } = req.body || {};
  if (!serial_no) throw err(400, 'Serial number required');
  await run(`INSERT INTO devices(name, serial_no, kind, location, active, created_at) VALUES(?,?, 'adms', ?, 1, ?) ON CONFLICT(serial_no) DO UPDATE SET active=1, name=excluded.name`, name || serial_no, serial_no, location || null, now());
  res.json({ ok: true });
});
r.get('/hr/punches', HR, async (req, res) => {
  const { date, unknown } = req.query;
  if (unknown) return res.json(await all(`SELECT biometric_id, COUNT(*) n, MAX(punch_time) last, MAX(device) device FROM punches WHERE employee_id IS NULL GROUP BY biometric_id ORDER BY last DESC LIMIT 200`));
  res.json(await all(`SELECT p.*, e.name, e.emp_code FROM punches p LEFT JOIN employees e ON e.id=p.employee_id WHERE substr(p.punch_time,1,10)=? ORDER BY p.punch_time DESC LIMIT 1000`, date || now().slice(0, 10)));
});
// Import punches [{biometric_id|emp_code, time}] or daily rows [{emp_code, date, in, out}]
r.post('/hr/punches/import', HR, async (req, res) => {
  const rows = (req.body?.rows || []).slice(0, 400);
  const list = [];
  for (const x of rows) {
    const id = x.biometric_id || x.emp_code;
    if (x.time) list.push({ biometric_id: id, time: x.time });
    else if (x.date) {
      if (x.in) list.push({ biometric_id: id, time: `${x.date} ${x.in}` });
      if (x.out) list.push({ biometric_id: id, time: `${x.date} ${x.out}` });
    }
  }
  res.json(await ingestPunches(list, { source: 'import', device: 'Excel import' }));
});

// ================================================================ attendance
r.get('/hr/attendance', HR, async (req, res) => {
  const month = req.query.month || now().slice(0, 7);
  const [from, to] = monthBounds(month);
  const { company, department, q } = req.query;
  const where = [`(e.exit_date IS NULL OR e.exit_date >= ?)`, `(e.joining_date IS NULL OR e.joining_date <= ?)`]; const p = [from, to];
  if (company) { where.push('e.company=?'); p.push(company); }
  if (department) { where.push('e.department=?'); p.push(department); }
  if (q) { where.push('(e.name LIKE ? OR e.emp_code LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  const emps = await all(`SELECT e.id, e.emp_code, e.name, e.department, e.designation, e.company FROM employees e WHERE ${where.join(' AND ')} ORDER BY e.emp_code LIMIT 500`, ...p);
  const att = await all(`SELECT a.employee_id, a.date, a.status, a.first_in, a.last_out, a.work_minutes, a.late_minutes, a.ot_minutes, a.leave_code, a.manual, a.remark
    FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date BETWEEN ? AND ? AND ${where.join(' AND ')}`, from, to, ...p);
  const map = {};
  for (const a of att) (map[a.employee_id] ||= {})[a.date] = a;
  res.json({ month, days: dayList(from, to), holidays: await all('SELECT * FROM holidays WHERE date BETWEEN ? AND ?', from, to), employees: emps.map((e) => ({ ...e, days: map[e.id] || {} })) });
});
r.post('/hr/attendance/process', HR, async (req, res) => {
  const { month, from, to, employee_ids, company, offset = 0, limit = 40 } = req.body || {};
  const [f, t] = month ? monthBounds(month) : [from, to];
  let ids = employee_ids;
  let total = null;
  if (!ids) {
    const rows = await all(`SELECT id FROM employees WHERE (exit_date IS NULL OR exit_date >= ?) AND (joining_date IS NULL OR joining_date <= ?) AND (? IS NULL OR company=?) ORDER BY id`, f, t, company || null, company || null);
    total = rows.length;
    ids = rows.slice(offset, offset + limit).map((x) => x.id);
  }
  const n = ids.length ? await processAttendance({ employeeIds: ids, from: f, to: t }) : 0;
  res.json({ rows: n, done: total == null ? ids.length : Math.min(total, offset + ids.length), total: total ?? ids.length, next: total != null && offset + ids.length < total ? offset + ids.length : null });
});
// HR override for one day
r.put('/hr/attendance/:employee_id/:date', HR, async (req, res) => {
  const { status, first_in, last_out, ot_minutes, remark, leave_code, reset } = req.body || {};
  const { employee_id, date } = req.params;
  if (reset) {
    await run('UPDATE attendance SET manual=0 WHERE employee_id=? AND date=?', employee_id, date);
    await processAttendance({ employeeIds: [Number(employee_id)], from: date, to: date });
    return res.json({ ok: true });
  }
  const fi = first_in ? `${date} ${first_in.slice(0, 5)}:00` : null;
  const lo = last_out ? `${date} ${last_out.slice(0, 5)}:00` : null;
  const work = fi && lo ? Math.max(0, Math.round((new Date(lo.replace(' ', 'T')) - new Date(fi.replace(' ', 'T'))) / 60000)) : 0;
  await run(`INSERT INTO attendance(employee_id, date, first_in, last_out, punch_count, work_minutes, ot_minutes, status, leave_code, remark, manual, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,1,?)
    ON CONFLICT(employee_id, date) DO UPDATE SET first_in=excluded.first_in, last_out=excluded.last_out, work_minutes=excluded.work_minutes, ot_minutes=excluded.ot_minutes,
    status=excluded.status, leave_code=excluded.leave_code, remark=excluded.remark, manual=1, updated_at=excluded.updated_at`,
  employee_id, date, fi, lo, (fi ? 1 : 0) + (lo ? 1 : 0), work, Number(ot_minutes) || 0, status, leave_code || null, `${remark || 'Edited by HR'} (${req.user.name})`, now());
  res.json({ ok: true });
});
r.get('/hr/attendance-requests', HR, async (req, res) => res.json(await all(`SELECT r.*, e.name, e.emp_code, e.department FROM attendance_requests r JOIN employees e ON e.id=r.employee_id
  WHERE (?='all' OR r.status=?) ORDER BY r.id DESC LIMIT 300`, req.query.status || 'Pending', req.query.status || 'Pending')));
r.post('/hr/attendance-requests/:id/decide', HR, async (req, res) => {
  const q = await get('SELECT * FROM attendance_requests WHERE id=?', req.params.id);
  if (!q || q.status !== 'Pending') throw err(400, 'Request not pending');
  const approve = !!req.body?.approve;
  await run('UPDATE attendance_requests SET status=?, decided_by=?, decided_at=?, remark=? WHERE id=?', approve ? 'Approved' : 'Rejected', req.user.id, now(), req.body?.remark || null, q.id);
  if (approve) await processAttendance({ employeeIds: [q.employee_id], from: q.date, to: q.date });
  res.json({ ok: true });
});

// ================================================================ leave (HR side)
r.get('/hr/leaves', HR, async (req, res) => {
  const status = req.query.status || 'Pending';
  res.json(await all(`SELECT l.*, e.name, e.emp_code, e.department, e.designation, t.name AS leave_name, u.name AS decided_by_name FROM leave_requests l JOIN employees e ON e.id=l.employee_id
    LEFT JOIN leave_types t ON t.code=l.leave_code LEFT JOIN users u ON u.id=l.decided_by WHERE (?='all' OR l.status=?) ORDER BY l.from_date DESC, l.id DESC LIMIT 500`, status, status));
});
r.get('/leave-approvals', async (req, res) => {
  // HR/admin see all pending; a reporting manager sees his team
  const all_ = ['admin', 'hr'].includes(req.user.role);
  res.json(await all(`SELECT l.*, e.name, e.emp_code, e.department, t.name AS leave_name FROM leave_requests l JOIN employees e ON e.id=l.employee_id LEFT JOIN leave_types t ON t.code=l.leave_code
    WHERE l.status='Pending' AND (? = 1 OR e.manager_user_id=?) ORDER BY l.from_date`, all_ ? 1 : 0, req.user.id));
});
r.post('/leaves/:id/decide', async (req, res) => res.json(await decideLeave(Number(req.params.id), req.body || {}, req.user)));
r.post('/leaves/:id/cancel', async (req, res) => res.json(await cancelLeave(Number(req.params.id), req.user)));
r.post('/hr/leaves', HR, async (req, res) => res.json(await applyLeave(req.body || {}, req.user))); // HR applies on behalf
r.get('/hr/employees/:id/balances', HR, async (req, res) => res.json(await balances(Number(req.params.id), Number(req.query.year) || undefined)));

// ================================================================ payroll
r.get('/hr/payroll', HR, async (req, res) => {
  const month = req.query.month || now().slice(0, 7);
  const runRow = await get('SELECT * FROM payroll_runs WHERE month=? AND company IS ?', month, req.query.company || null);
  const slips = runRow ? await all(`SELECT p.id, p.employee_id, p.gross, p.deductions, p.net, p.paid_days, p.published, p.data, e.emp_code, e.name, e.department, e.company, e.bank_name, e.account_no, e.ifsc
    FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=? ORDER BY e.emp_code`, runRow.id) : [];
  res.json({ run: runRow || null, slips: slips.map((s) => { const d = JSON.parse(s.data); delete s.data; return { ...s, summary: { present: d.present, half: d.half, absent: d.absent, paid_leave: d.paid_leave, lop: d.lop_days, ot_hours: d.ot_hours, late: d.late, weekly_off: d.weekly_off } }; }),
    runs: await all('SELECT * FROM payroll_runs ORDER BY month DESC LIMIT 24'),
    adjustments: await all(`SELECT a.*, e.name, e.emp_code FROM salary_adjustments a JOIN employees e ON e.id=a.employee_id WHERE a.month=? ORDER BY a.id DESC`, month), kinds: ADJUSTMENT_KINDS });
});
r.post('/hr/payroll/generate', HR, async (req, res) => res.json(await generatePayroll({ month: req.body?.month, company: req.body?.company || null, offset: Number(req.body?.offset) || 0 }, req.user)));
r.post('/hr/payroll/:id/status', HR, async (req, res) => {
  const { status } = req.body || {};
  if (!['Draft', 'Locked', 'Paid'].includes(status)) throw err(400, 'Bad status');
  if (status === 'Draft' && req.user.role !== 'admin') throw err(403, 'Only admin can unlock payroll');
  const runRow = await get('SELECT month FROM payroll_runs WHERE id=?', req.params.id);
  if (status !== 'Draft' && runRow && monthBounds(runRow.month)[1] >= now().slice(0, 10) && req.user.role !== 'admin') throw err(400, 'The month is not finished yet – only admin can lock it early');
  await run('UPDATE payroll_runs SET status=?, locked_at=CASE WHEN ?<>\'Draft\' THEN ? ELSE NULL END WHERE id=?', status, status, now(), req.params.id);
  res.json({ ok: true });
});
// publish = employees can see the slip + WhatsApp / email goes out (in batches)
r.post('/hr/payroll/:id/publish', HR, async (req, res) => {
  const runRow = await get('SELECT * FROM payroll_runs WHERE id=?', req.params.id);
  if (!runRow) throw err(404, 'Payroll not found');
  if (runRow.status === 'Draft') throw err(400, 'Lock the payroll before publishing');
  const slips = await all('SELECT id, employee_id FROM payslips WHERE run_id=? AND published=0 LIMIT 20', runRow.id);
  for (const s of slips) {
    await run('UPDATE payslips SET published=1 WHERE id=?', s.id);
    await runAutomations('payslip.published', { employee_id: s.employee_id, payslip_id: s.id, user: req.user });
  }
  const left = (await get('SELECT COUNT(*) n FROM payslips WHERE run_id=? AND published=0', runRow.id)).n;
  res.json({ published: slips.length, left });
});
r.post('/hr/salary-adjustments', HR, async (req, res) => {
  const { employee_id, month, kind, amount, note } = req.body || {};
  if (!employee_id || !month || !ADJUSTMENT_KINDS[kind] || !Number(amount)) throw err(400, 'Employee, month, type and amount are required');
  const runRow = await get(`SELECT status FROM payroll_runs WHERE month=? AND status<>'Draft'`, month);
  if (runRow) throw err(400, 'Payroll for this month is locked');
  await run('INSERT INTO salary_adjustments(employee_id, month, kind, amount, note, created_by, created_at) VALUES(?,?,?,?,?,?,?)', employee_id, month, kind, Math.abs(Number(amount)), note || null, req.user.id, now());
  res.json({ ok: true });
});
r.delete('/hr/salary-adjustments/:id', HR, async (req, res) => { await run('DELETE FROM salary_adjustments WHERE id=?', req.params.id); res.json({ ok: true }); });

// payslip (HR, or the employee himself when published)
r.get('/payslips/:id', async (req, res) => {
  const p = await get('SELECT p.*, e.user_id, r.status AS run_status FROM payslips p JOIN employees e ON e.id=p.employee_id JOIN payroll_runs r ON r.id=p.run_id WHERE p.id=?', req.params.id);
  if (!p) throw err(404, 'Payslip not found');
  const isHR = ['admin', 'hr', 'accounts'].includes(req.user.role);
  if (!isHR && (p.user_id !== req.user.id || !p.published)) throw err(403, 'Not allowed');
  const data = JSON.parse(p.data);
  res.json({ id: p.id, month: p.month, run_status: p.run_status, published: p.published, ...data, net_words: `Rupees ${inWords(data.net)} Only`, company_name: await setting('company_name', 'EPIL Group'), address: await setting('office_address', '') });
});
r.get('/hr/payroll/:id/export', HR, async (req, res) => {
  const rows = await all(`SELECT p.data, e.emp_code, e.name, e.bank_name, e.account_no, e.ifsc FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=? ORDER BY e.emp_code`, req.params.id);
  const kind = req.query.kind || 'register';
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  let lines;
  if (kind === 'bank') {
    lines = [['Emp Code', 'Name', 'Bank', 'Account No', 'IFSC', 'Net Pay'], ...rows.map((r_) => { const d = JSON.parse(r_.data); return [r_.emp_code, r_.name, r_.bank_name, r_.account_no, r_.ifsc, d.net]; })];
  } else {
    const heads = new Set(); const dheads = new Set();
    const parsed = rows.map((r_) => { const d = JSON.parse(r_.data); d.earnings.forEach((e) => heads.add(e.name.replace(/ \(.*\)$/, ''))); d.deductions.forEach((e) => dheads.add(e.name.replace(/ \(.*\)$/, ''))); return { ...r_, d }; });
    const H = [...heads]; const DH = [...dheads];
    lines = [['Emp Code', 'Name', 'Days', 'Paid days', 'Present', 'Absent', 'Paid leave', 'LOP', 'OT hours', ...H, 'Gross', ...DH, 'Total deductions', 'Net pay'],
      ...parsed.map(({ emp_code, name, d }) => {
        const em = (n) => d.earnings.filter((e) => e.name.replace(/ \(.*\)$/, '') === n).reduce((s, e) => s + e.amount, 0);
        const dm = (n) => d.deductions.filter((e) => e.name.replace(/ \(.*\)$/, '') === n).reduce((s, e) => s + e.amount, 0);
        return [emp_code, name, d.days_in_month, d.paid_days, d.present, d.absent, d.paid_leave, d.lop_days, d.ot_hours, ...H.map(em), d.gross, ...DH.map(dm), d.total_deductions, d.net];
      })];
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${kind}-${req.params.id}.csv"`);
  res.send('﻿' + lines.map((l) => l.map(esc).join(',')).join('\n'));
});

// ================================================================ self-service (/me) – any logged-in user linked to an employee
async function myEmployee(req) {
  const e = await get('SELECT e.*, s.name AS shift_name, s.start_time, s.end_time FROM employees e LEFT JOIN shifts s ON s.id=e.shift_id WHERE e.user_id=?', req.user.id);
  if (!e) throw err(404, 'Your login is not linked to an employee record yet – ask HR');
  return e;
}
r.get('/me/hr', async (req, res) => {
  const e = await get('SELECT e.id, e.emp_code, e.name, e.designation, e.department, e.company, e.joining_date, s.name AS shift_name, s.start_time, s.end_time FROM employees e LEFT JOIN shifts s ON s.id=e.shift_id WHERE e.user_id=?', req.user.id);
  if (!e) return res.json({ employee: null });
  const month = req.query.month || now().slice(0, 7);
  const [from, to] = monthBounds(month);
  res.json({
    employee: e, month,
    attendance: await all('SELECT date, status, first_in, last_out, work_minutes, late_minutes, ot_minutes, leave_code, remark FROM attendance WHERE employee_id=? AND date BETWEEN ? AND ? ORDER BY date', e.id, from, to),
    balances: await balances(e.id),
    leaves: await all('SELECT l.*, t.name AS leave_name FROM leave_requests l LEFT JOIN leave_types t ON t.code=l.leave_code WHERE employee_id=? ORDER BY id DESC LIMIT 50', e.id),
    requests: await all('SELECT * FROM attendance_requests WHERE employee_id=? ORDER BY id DESC LIMIT 20', e.id),
    payslips: await all('SELECT id, month, net, paid_days FROM payslips WHERE employee_id=? AND published=1 ORDER BY month DESC', e.id),
    leave_types: await all('SELECT code, name, allow_half_day FROM leave_types WHERE active=1 ORDER BY code'),
    holidays: await all('SELECT * FROM holidays WHERE date >= ? ORDER BY date LIMIT 20', now().slice(0, 10)),
  });
});
r.post('/me/leave', async (req, res) => {
  const e = await myEmployee(req);
  res.json(await applyLeave({ ...req.body, employee_id: e.id }, req.user));
});
r.post('/me/attendance-request', async (req, res) => {
  const e = await myEmployee(req);
  const { date, in_time, out_time, reason } = req.body || {};
  if (!date || (!in_time && !out_time)) throw err(400, 'Date and in or out time are required');
  if (date > now().slice(0, 10)) throw err(400, 'Date cannot be in the future');
  const x = await run('INSERT INTO attendance_requests(employee_id, date, in_time, out_time, reason, status, created_at) VALUES(?,?,?,?,?, \'Pending\', ?)', e.id, date, in_time || null, out_time || null, reason || null, now());
  await runAutomations('attendance.request', { employee_id: e.id, extra: { date, in_time: in_time || '-', out_time: out_time || '-', reason: reason || '-', portal_link: `${await setting('public_url', '')}/hr/attendance` } });
  res.json({ id: Number(x.lastInsertRowid) });
});

export default r;
