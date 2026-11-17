// Leave: types, balances, apply, approve / reject, cancel
import { all, get, run, now, parse } from '../db.js';
import { dayList, shiftsMap, DEFAULT_SHIFT, processAttendance } from './attendance.js';

export const DEFAULT_LEAVE_TYPES = [
  // code, name, paid, quota, accrual, carry, half, negative
  ['CL', 'Casual Leave', 1, 7, 'yearly', 0, 1, 0],
  ['SL', 'Sick Leave', 1, 7, 'yearly', 0, 1, 0],
  ['EL', 'Earned / Privilege Leave', 1, 12, 'monthly', 30, 0, 0],
  ['CO', 'Compensatory Off', 1, 0, 'yearly', 0, 1, 0],
  ['LWP', 'Leave Without Pay', 0, 0, 'yearly', 0, 1, 1],
];
export async function seedLeaveTypes() {
  for (const [code, name, paid, q, acc, cf, half, neg] of DEFAULT_LEAVE_TYPES) {
    await run(`INSERT INTO leave_types(code,name,paid,annual_quota,accrual,carry_forward_max,allow_half_day,allow_negative) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(code) DO NOTHING`, code, name, paid, q, acc, cf, half, neg);
  }
}

const err = (status, message) => Object.assign(new Error(message), { status });

/** Working days between two dates for this employee (weekly offs and holidays are not counted). */
export async function leaveDays(emp, from, to, half) {
  if (half) return 0.5;
  const shifts = await shiftsMap();
  const sh = shifts[emp.shift_id] || DEFAULT_SHIFT;
  const offs = String(sh.weekly_off ?? '0').split(',').filter((x) => x !== '').map(Number);
  const hol = new Set((await all('SELECT date FROM holidays WHERE date BETWEEN ? AND ?', from, to)).map((h) => h.date));
  return dayList(from, to).filter((d) => !offs.includes(parse(d).getUTCDay()) && !hol.has(d)).length;
}

/** Balance per leave type for a year: entitlement + adjustments - approved (and pending shown separately). */
export async function balances(employee_id, year = Number(now().slice(0, 4))) {
  const emp = await get('SELECT * FROM employees WHERE id=?', employee_id);
  if (!emp) throw err(404, 'Employee not found');
  const types = await all('SELECT * FROM leave_types WHERE active=1 ORDER BY code');
  const adj = await all('SELECT leave_code, SUM(days) d FROM leave_adjustments WHERE employee_id=? AND year=? GROUP BY leave_code', employee_id, year);
  const used = await all(`SELECT leave_code, status, SUM(days) d FROM leave_requests WHERE employee_id=? AND substr(from_date,1,4)=? AND status IN ('Approved','Pending') GROUP BY leave_code, status`, employee_id, String(year));
  const today = now();
  const curYear = Number(today.slice(0, 4));
  const curMonth = Number(today.slice(5, 7));
  const join = emp.joining_date ? parse(emp.joining_date) : null;
  return types.map((t) => {
    let months = 12;
    if (join && join.getUTCFullYear() === year) months = 12 - join.getUTCMonth();
    let entitled = t.accrual === 'monthly'
      ? (t.annual_quota / 12) * (year < curYear ? months : Math.max(0, Math.min(months, curMonth - (join && join.getUTCFullYear() === year ? join.getUTCMonth() : 0))))
      : (t.annual_quota * months) / 12;
    entitled = Math.round(entitled * 2) / 2;
    const extra = adj.find((a) => a.leave_code === t.code)?.d || 0;
    const taken = used.find((u) => u.leave_code === t.code && u.status === 'Approved')?.d || 0;
    const pending = used.find((u) => u.leave_code === t.code && u.status === 'Pending')?.d || 0;
    return { code: t.code, name: t.name, paid: t.paid, entitled, adjusted: extra, taken, pending, balance: Math.round((entitled + extra - taken) * 2) / 2, allow_half_day: t.allow_half_day, allow_negative: t.allow_negative };
  });
}

export async function applyLeave({ employee_id, leave_code, from_date, to_date, half_day, reason }, user) {
  const emp = await get('SELECT * FROM employees WHERE id=?', employee_id);
  if (!emp) throw err(404, 'Employee not found');
  const type = await get('SELECT * FROM leave_types WHERE code=? AND active=1', leave_code);
  if (!type) throw err(400, 'Choose a leave type');
  to_date = to_date || from_date;
  if (!from_date || to_date < from_date) throw err(400, 'Check the dates');
  if (half_day && from_date !== to_date) throw err(400, 'Half day is only for a single date');
  if (half_day && !type.allow_half_day) throw err(400, `${type.name} cannot be taken as half day`);
  const overlap = await get(`SELECT id FROM leave_requests WHERE employee_id=? AND status IN ('Pending','Approved') AND from_date <= ? AND to_date >= ?`, employee_id, to_date, from_date);
  if (overlap) throw err(400, 'You already have a leave request for these dates');
  const days = await leaveDays(emp, from_date, to_date, half_day);
  if (!days) throw err(400, 'These dates are weekly off / holidays');
  if (!type.allow_negative) {
    const b = (await balances(employee_id, Number(from_date.slice(0, 4)))).find((x) => x.code === leave_code);
    if (b && b.balance - b.pending < days) throw err(400, `Not enough ${type.name} balance (available ${b.balance - b.pending}, asked ${days})`);
  }
  const r = await run(`INSERT INTO leave_requests(employee_id, leave_code, from_date, to_date, half_day, days, reason, status, applied_by, created_at) VALUES(?,?,?,?,?,?,?, 'Pending', ?, ?)`,
    employee_id, leave_code, from_date, to_date, half_day || null, days, reason || null, user?.id ?? null, now());
  const id = Number(r.lastInsertRowid);
  const { runAutomations } = await import('../automation.js');
  await runAutomations('leave.applied', { employee_id, leave_id: id, user });
  return { id, days };
}

export async function decideLeave(id, { approve, remark }, user) {
  const l = await get('SELECT * FROM leave_requests WHERE id=?', id);
  if (!l) throw err(404, 'Leave request not found');
  if (l.status !== 'Pending') throw err(400, `Already ${l.status}`);
  const emp = await get('SELECT * FROM employees WHERE id=?', l.employee_id);
  if (user.role !== 'admin' && user.role !== 'hr' && emp.manager_user_id !== user.id) throw err(403, 'Only HR, admin or the reporting manager can decide');
  if (emp.user_id && emp.user_id === user.id && user.role !== 'admin') throw err(403, 'You cannot approve your own leave');
  const status = approve ? 'Approved' : 'Rejected';
  await run('UPDATE leave_requests SET status=?, decided_by=?, decided_at=?, decision_remark=? WHERE id=?', status, user.id, now(), remark || null, id);
  if (approve) await processAttendance({ employeeIds: [l.employee_id], from: l.from_date, to: l.to_date });
  const { runAutomations } = await import('../automation.js');
  await runAutomations(approve ? 'leave.approved' : 'leave.rejected', { employee_id: l.employee_id, leave_id: id, user, remark });
  return { status };
}

export async function cancelLeave(id, user) {
  const l = await get('SELECT * FROM leave_requests WHERE id=?', id);
  if (!l) throw err(404, 'Leave request not found');
  const emp = await get('SELECT user_id FROM employees WHERE id=?', l.employee_id);
  const own = emp?.user_id === user.id;
  if (!own && !['admin', 'hr'].includes(user.role)) throw err(403, 'Not allowed');
  if (l.status === 'Approved' && own && l.from_date <= now().slice(0, 10)) throw err(400, 'Leave already started – ask HR to cancel');
  if (!['Pending', 'Approved'].includes(l.status)) throw err(400, `Already ${l.status}`);
  await run(`UPDATE leave_requests SET status='Cancelled', decided_by=?, decided_at=? WHERE id=?`, user.id, now(), id);
  if (l.status === 'Approved') await processAttendance({ employeeIds: [l.employee_id], from: l.from_date, to: l.to_date });
  return { ok: true };
}
