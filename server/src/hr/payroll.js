// Payroll: attendance + rules -> payslip for every employee of a month.
import { all, get, run, batch, now } from '../db.js';
import { hrSettings, shiftsMap, DEFAULT_SHIFT } from './attendance.js';

const r2 = (n) => Math.round(n * 100) / 100;
const daysInMonth = (month) => { const [y, m] = month.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const EARN_KINDS = { bonus: 'Bonus', incentive: 'Incentive', arrear: 'Arrears', allowance: 'Other allowance' };
const DED_KINDS = { advance: 'Salary advance', loan: 'Loan EMI', fine: 'Fine / penalty', tds: 'TDS (income tax)', other_deduction: 'Other deduction' };
export const ADJUSTMENT_KINDS = { ...EARN_KINDS, ...DED_KINDS };

function ptFor(gross, slabs) {
  // "0:0,12000:200" -> highest slab whose lower bound <= gross
  const list = String(slabs || '').split(',').map((x) => x.split(':').map(Number)).filter((x) => x.length === 2 && !x.some(Number.isNaN)).sort((a, b) => a[0] - b[0]);
  let amt = 0;
  for (const [min, v] of list) if (gross >= min) amt = v;
  return amt;
}

/** Pure calculation for one employee. days = attendance rows of the month. */
export function computeSlip(emp, days, adjustments, S, shift, month, leaveTypes, today = '9999-12-31') {
  const D = daysInMonth(month);
  const basis = S.pay_days_basis;
  const divisor = basis === '30' ? 30 : basis === '26' ? 26 : D;
  const c = { projected: 0, present: 0, half: 0, absent: 0, weekly_off: 0, holiday: 0, paid_leave: 0, unpaid_leave: 0, missed_punch: 0, off_day_worked: 0, not_employed: 0, late: 0, ot_minutes: 0, work_minutes: 0, sandwich: 0 };
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const dates = Array.from({ length: D }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
  let credit = 0; // paid day credit from attendance
  const unpaidAbsent = (st) => st === 'A' || st === 'MP';
  for (let i = 0; i < D; i++) {
    const a = byDate[dates[i]];
    if (dates[i] > today && !a?.manual) { c.projected++; credit += 1; continue; } // month not finished yet: assume a normal paid day
    const st = a?.status || 'A';
    const lt = a?.leave_code ? leaveTypes[a.leave_code] : null;
    c.ot_minutes += a?.ot_minutes || 0;
    c.work_minutes += a?.work_minutes || 0;
    if (a?.late_minutes > 0) c.late++;
    switch (st) {
      case 'P': c.present++; credit += 1; break;
      case 'HD': c.half++; credit += 0.5; if (a.leave_code) { if (lt?.paid) { c.paid_leave += 0.5; credit += 0.5; } else c.unpaid_leave += 0.5; } break;
      case 'L': if (lt && !lt.paid) c.unpaid_leave++; else { c.paid_leave++; credit += 1; } break;
      case 'WOP': case 'HP': c.off_day_worked++; credit += 1; if (st === 'WOP') c.weekly_off++; else c.holiday++; break;
      case 'WO': case 'H': {
        st === 'WO' ? c.weekly_off++ : c.holiday++;
        const paid = st === 'WO' ? S.weekly_off_paid === '1' : S.holiday_paid === '1';
        // sandwich: an off day between two unpaid absences is not paid
        const prev = byDate[dates[i - 1]]?.status; const next = byDate[dates[i + 1]]?.status;
        if (S.sandwich_leave === '1' && unpaidAbsent(prev) && unpaidAbsent(next)) { c.sandwich++; break; }
        if (paid && (basis !== '26' || st === 'H')) credit += 1;
        break;
      }
      case 'NA': c.not_employed++; break;
      case 'MP': c.missed_punch++; break;
      default: c.absent++; if (a?.leave_code && lt?.paid) { c.paid_leave += 0.5; credit += 0.5; }
    }
  }
  const latePenalty = Number(S.late_penalty_count) > 0 ? Math.floor(c.late / Number(S.late_penalty_count)) * 0.5 : 0;
  // days that should have been paid in this basis
  const payable = basis === '26' ? D - c.weekly_off : D;
  let lop = Math.max(0, payable - credit) + latePenalty;
  let paidDays = basis === 'calendar' ? Math.max(0, D - lop) : Math.max(0, divisor - lop * (divisor / payable));
  paidDays = Math.min(divisor, Math.round(paidDays * 2) / 2);

  const earnings = []; const deductions = []; const employer = [];
  const shiftHours = shift.full_day_hours || 8;
  let otHours = c.ot_minutes / 60;
  if (Number(S.ot_max_hours_month) > 0) otHours = Math.min(otHours, Number(S.ot_max_hours_month));
  otHours = Math.round(otHours * 2) / 2;
  let basicEarned = 0;
  let fixedGross = emp.gross_salary;

  if (emp.salary_type === 'daily') {
    const workDays = c.present + c.half * 0.5 + c.paid_leave + c.off_day_worked;
    const amt = emp.gross_salary * workDays;
    basicEarned = amt * Number(S.basic_pct) / 100;
    earnings.push({ name: `Wages (${workDays} days × ₹${emp.gross_salary})`, amount: r2(amt) });
    fixedGross = emp.gross_salary * divisor;
    paidDays = workDays;
  } else if (emp.salary_type === 'hourly') {
    const hrs = Math.round((c.work_minutes / 60) * 10) / 10;
    const amt = emp.gross_salary * hrs;
    basicEarned = amt * Number(S.basic_pct) / 100;
    earnings.push({ name: `Wages (${hrs} h × ₹${emp.gross_salary})`, amount: r2(amt) });
    fixedGross = emp.gross_salary * shiftHours * divisor;
  } else {
    const ratio = paidDays / divisor;
    const basic = emp.gross_salary * Number(S.basic_pct) / 100;
    const hra = basic * Number(S.hra_pct) / 100;
    const special = emp.gross_salary - basic - hra;
    basicEarned = basic * ratio;
    earnings.push({ name: 'Basic + DA', amount: r2(basic * ratio), fixed: r2(basic) });
    if (hra) earnings.push({ name: 'HRA', amount: r2(hra * ratio), fixed: r2(hra) });
    if (special > 0) earnings.push({ name: 'Special allowance', amount: r2(special * ratio), fixed: r2(special) });
  }
  if (otHours > 0 && emp.ot_allowed) {
    const base = emp.salary_type === 'hourly' ? emp.gross_salary * shiftHours * divisor
      : emp.salary_type === 'daily' ? emp.gross_salary * divisor
        : S.ot_basis === 'basic' ? emp.gross_salary * Number(S.basic_pct) / 100 : emp.gross_salary;
    const rate = base / divisor / shiftHours * Number(S.ot_multiplier);
    earnings.push({ name: `Overtime (${otHours} h × ₹${r2(rate)})`, amount: r2(otHours * rate) });
  }
  for (const a of adjustments.filter((x) => EARN_KINDS[x.kind])) earnings.push({ name: `${EARN_KINDS[a.kind]}${a.note ? ` – ${a.note}` : ''}`, amount: r2(a.amount) });
  const gross = r2(earnings.reduce((s, e) => s + e.amount, 0));

  if (emp.pf_applicable) {
    const pfWage = Math.min(basicEarned, Number(S.pf_ceiling) || basicEarned);
    deductions.push({ name: `Provident Fund (${S.pf_rate}%)`, amount: Math.round(pfWage * Number(S.pf_rate) / 100) });
    employer.push({ name: `Employer PF (${S.pf_employer_rate}%)`, amount: Math.round(pfWage * Number(S.pf_employer_rate) / 100) });
  }
  if (emp.esic_applicable && fixedGross <= Number(S.esic_limit)) {
    deductions.push({ name: `ESIC (${S.esic_rate}%)`, amount: Math.ceil(gross * Number(S.esic_rate) / 100) });
    employer.push({ name: `Employer ESIC (${S.esic_employer_rate}%)`, amount: Math.ceil(gross * Number(S.esic_employer_rate) / 100) });
  }
  if (emp.pt_applicable) { const pt = ptFor(gross, S.pt_slabs); if (pt) deductions.push({ name: 'Professional tax', amount: pt }); }
  for (const a of adjustments.filter((x) => DED_KINDS[x.kind])) deductions.push({ name: `${DED_KINDS[a.kind]}${a.note ? ` – ${a.note}` : ''}`, amount: r2(Math.abs(a.amount)) });
  const totalDed = r2(deductions.reduce((s, d) => s + d.amount, 0));
  const net = Math.max(0, Math.round(gross - totalDed));

  return {
    month, days_in_month: D, divisor, basis, ...c, ot_hours: otHours, work_hours: Math.round(c.work_minutes / 6) / 10,
    late_penalty_days: latePenalty, lop_days: Math.round(lop * 2) / 2, paid_days: paidDays,
    salary_type: emp.salary_type, fixed_gross: r2(fixedGross),
    earnings, deductions, employer, gross, total_deductions: totalDed, net,
    employee: { name: emp.name, emp_code: emp.emp_code, designation: emp.designation, department: emp.department, company: emp.company, location: emp.location,
      joining_date: emp.joining_date, bank_name: emp.bank_name, account_no: emp.account_no, ifsc: emp.ifsc, pan: emp.pan, uan: emp.uan, esic_no: emp.esic_no },
  };
}

/** Generate (or regenerate) the draft run for a month, optionally a slice of employees for big companies. */
export async function generatePayroll({ month, company = null, offset = 0, limit = 60 }, user) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw Object.assign(new Error('Month must be YYYY-MM'), { status: 400 });
  let runRow = await get('SELECT * FROM payroll_runs WHERE month=? AND company IS ?', month, company);
  if (runRow && runRow.status !== 'Draft') throw Object.assign(new Error(`Payroll for ${month} is ${runRow.status}. Unlock it first.`), { status: 400 });
  if (!runRow) {
    await run('INSERT INTO payroll_runs(month, company, status, created_by, created_at) VALUES(?,?, \'Draft\', ?, ?)', month, company, user?.id ?? null, now());
    runRow = await get('SELECT * FROM payroll_runs WHERE month=? AND company IS ?', month, company);
  }
  const first = `${month}-01`; const last = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const emps = await all(`SELECT * FROM employees WHERE (joining_date IS NULL OR joining_date <= ?) AND (exit_date IS NULL OR exit_date >= ?) AND (? IS NULL OR company=?)
    ORDER BY emp_code LIMIT ? OFFSET ?`, last, first, company, company, limit, offset);
  const total = (await get(`SELECT COUNT(*) n FROM employees WHERE (joining_date IS NULL OR joining_date <= ?) AND (exit_date IS NULL OR exit_date >= ?) AND (? IS NULL OR company=?)`, last, first, company, company)).n;
  if (emps.length) {
    const S = await hrSettings();
    const shifts = await shiftsMap();
    const leaveTypes = Object.fromEntries((await all('SELECT code, paid FROM leave_types')).map((l) => [l.code, l]));
    const ids = emps.map((e) => e.id);
    const inIds = `(${ids.map(() => '?').join(',')})`;
    const att = await all(`SELECT employee_id, date, status, leave_code, late_minutes, ot_minutes, work_minutes, manual FROM attendance WHERE employee_id IN ${inIds} AND date BETWEEN ? AND ?`, ...ids, first, last);
    const adj = await all(`SELECT * FROM salary_adjustments WHERE employee_id IN ${inIds} AND month=?`, ...ids, month);
    const ts = now();
    const writes = emps.map((e) => {
      const slip = computeSlip(e, att.filter((a) => a.employee_id === e.id), adj.filter((a) => a.employee_id === e.id), S, shifts[e.shift_id] || DEFAULT_SHIFT, month, leaveTypes, now().slice(0, 10));
      return [`INSERT INTO payslips(run_id, employee_id, month, data, gross, deductions, net, paid_days, published, created_at) VALUES(?,?,?,?,?,?,?,?,0,?)
        ON CONFLICT(run_id, employee_id) DO UPDATE SET data=excluded.data, gross=excluded.gross, deductions=excluded.deductions, net=excluded.net, paid_days=excluded.paid_days, created_at=excluded.created_at`,
      runRow.id, e.id, month, JSON.stringify(slip), slip.gross, slip.total_deductions, slip.net, slip.paid_days, ts];
    });
    await batch(writes);
  }
  await refreshRunTotals(runRow.id);
  return { run_id: runRow.id, done: Math.min(total, offset + emps.length), total, next: offset + emps.length < total ? offset + emps.length : null };
}

export async function refreshRunTotals(runId) {
  const t = await get('SELECT COUNT(*) n, COALESCE(SUM(gross),0) g, COALESCE(SUM(deductions),0) d, COALESCE(SUM(net),0) net FROM payslips WHERE run_id=?', runId);
  await run('UPDATE payroll_runs SET employees=?, gross=?, deductions=?, net=? WHERE id=?', t.n, t.g, t.d, t.net, runId);
}

/** Amount in Indian words for the slip */
export function inWords(n) {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : `${b[Math.floor(x / 10)]}${x % 10 ? ` ${a[x % 10]}` : ''}`);
  const three = (x) => `${x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' : ''}` : ''}${x % 100 ? two(x % 100) : ''}`;
  n = Math.round(n);
  if (!n) return 'Zero';
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(`${two(cr)} Crore`);
  if (lk) parts.push(`${two(lk)} Lakh`);
  if (th) parts.push(`${two(th)} Thousand`);
  if (n) parts.push(three(n));
  return parts.join(' ');
}

