// Automation rules: when something happens (a step result, a new requirement, an interview date,
// a daily cron) the matching rules send WhatsApp / email by themselves, and can auto-complete a step.
import { all, get, run, now, setting, nowWall, fmt } from './db.js';
import { fillTemplate, candidateVars, sendWhatsApp, sendEmail } from './notify.js';

export const EVENTS = {
  'requirement.created': 'New requirement raised',
  'S04:Accepted': 'Screening accepted',
  'S04:Rejected': 'Screening rejected',
  'S05:Interested': 'Candidate interested',
  'interview.scheduled': 'Interview date fixed',
  'cron.interview_reminder': 'Day before interview (auto, every hour)',
  'S08:Hold': 'Interview result = Hold',
  'S08:Rejected': 'Interview rejected',
  'S11:Selected': 'Final selected',
  'S11:Rejected': 'Final rejected',
  'S15:Joined': 'Joined (Day 1)',
  'S19:Working': '6-day follow-up done',
  'cron.daily_digest': 'Every morning 9:30 (auto)',
  'leave.applied': 'Employee applied for leave',
  'leave.approved': 'Leave approved',
  'leave.rejected': 'Leave rejected',
  'payslip.published': 'Salary slip published',
  'attendance.request': 'Attendance correction requested',
  'cron.absent_digest': 'Every morning ~10:00 – yesterday attendance (auto)',
  'cron.missed_punch': 'Every morning ~10:00 – missed punch / absent alert (auto)',
};
export const RECIPIENTS = { candidate: 'Candidate', consultancy: 'Consultancy (if source is a consultancy)', approver: 'Approver (Ritesh Sir)', recruiter: 'Recruiter', hod: 'HOD', doer: 'Each doer (own tasks)', employee: 'Employee', manager: 'Reporting manager', hr: 'HR team', admin: 'Admin' };

const DEFAULTS = [
  ['requirement.created', 'Tell recruiter about new requirement', 'email', 'recruiter', 'new_requirement', null, 1],
  ['S04:Accepted', 'Ask candidate if interested', 'whatsapp', 'candidate', 'interest', null, 1],
  ['S05:Interested', 'Send application form link', 'whatsapp', 'candidate', 'apply_form', null, 1],
  ['interview.scheduled', 'Interview invitation (WhatsApp)', 'whatsapp', 'candidate', 'interview', null, 1],
  ['interview.scheduled', 'Interview invitation (email)', 'email', 'candidate', 'interview_email', null, 1],
  ['cron.interview_reminder', 'Interview reminder one day before', 'whatsapp', 'candidate', 'interview_reminder', null, 1],
  ['S08:Hold', 'Ask Ritesh Sir for hold decision', 'email', 'approver', 'hold_alert', null, 1],
  ['S04:Rejected', 'Regret message after screening', 'whatsapp', 'candidate', 'regret', null, 0],
  ['S08:Rejected', 'Regret message after interview', 'whatsapp', 'candidate', 'regret', null, 0],
  ['S11:Rejected', 'Regret message after final round', 'whatsapp', 'candidate', 'regret', null, 0],
  ['S11:Selected', 'Selection message to candidate', 'whatsapp', 'candidate', 'selection', null, 1],
  ['S11:Selected', 'Selection email to consultancy (completes Step 12)', 'email', 'consultancy', 'consultancy_selection', 'S12', 1],
  ['S15:Joined', 'Welcome message on joining', 'whatsapp', 'candidate', 'welcome', null, 1],
  ['S19:Working', 'Send feedback form link', 'whatsapp', 'candidate', 'feedback', null, 1],
  ['cron.daily_digest', 'Daily task list to every doer', 'email', 'doer', 'daily_digest', null, 1],
  ['leave.applied', 'Leave request to HR (email)', 'email', 'hr', 'leave_applied_email', null, 1],
  ['leave.applied', 'Leave request to HR (WhatsApp)', 'whatsapp', 'hr', 'leave_applied_wa', null, 1],
  ['leave.applied', 'Leave request to reporting manager', 'whatsapp', 'manager', 'leave_applied_wa', null, 1],
  ['leave.approved', 'Leave approved – tell employee (WhatsApp)', 'whatsapp', 'employee', 'leave_decision_wa', null, 1],
  ['leave.approved', 'Leave approved – tell employee (email)', 'email', 'employee', 'leave_decision_email', null, 1],
  ['leave.rejected', 'Leave rejected – tell employee (WhatsApp)', 'whatsapp', 'employee', 'leave_decision_wa', null, 1],
  ['leave.rejected', 'Leave rejected – tell employee (email)', 'email', 'employee', 'leave_decision_email', null, 1],
  ['payslip.published', 'Salary slip – WhatsApp to employee', 'whatsapp', 'employee', 'payslip_wa', null, 1],
  ['payslip.published', 'Salary slip – email to employee', 'email', 'employee', 'payslip_email', null, 1],
  ['attendance.request', 'Attendance correction to HR', 'email', 'hr', 'attendance_request_email', null, 1],
  ['cron.absent_digest', 'Yesterday attendance summary to HR', 'email', 'hr', 'absent_digest', null, 1],
  ['cron.missed_punch', 'Missed punch / absent alert to employee', 'whatsapp', 'employee', 'missed_punch_wa', null, 0],
];

export async function seedAutomations() {
  for (const [event, name, channel, recipient, template_key, complete_step, enabled] of DEFAULTS) {
    await run(`INSERT INTO automations(event,name,channel,recipient,template_key,complete_step,enabled) VALUES(?,?,?,?,?,?,?)
               ON CONFLICT(event,channel,recipient,template_key) DO NOTHING`, event, name, channel, recipient, template_key, complete_step, enabled);
  }
}

async function usersByRole(role) {
  return all('SELECT id, name, email, phone FROM users WHERE role=? AND active=1', role);
}

async function isConsultancy(source) {
  const p = await get('SELECT method FROM platforms WHERE name=?', source || '');
  return p?.method === 'email';
}

/**
 * Fire all enabled rules for an event.
 * ctx: { candidate_id?, requirement_id?, remark?, user?, extra? }
 */
export async function runAutomations(event, ctx = {}) {
  const rules = await all('SELECT * FROM automations WHERE event=? AND enabled=1', event);
  const results = [];
  for (const rule of rules) {
    try {
      results.push(await runRule(rule, ctx));
    } catch (e) {
      console.error(`[automation ${rule.id}]`, e.message);
      results.push({ rule: rule.id, error: e.message });
    }
  }
  return results;
}

async function runRule(rule, ctx) {
  const tpl = await get('SELECT * FROM templates WHERE key=?', rule.template_key);
  if (!tpl) return { rule: rule.id, skipped: 'template missing' };
  const base = await setting('public_url', '');
  let vars = { portal_link: base, remark: ctx.remark || '', ...(ctx.extra || {}) };
  let candidate = null;
  if (ctx.candidate_id) {
    candidate = await get('SELECT * FROM candidates WHERE id=?', ctx.candidate_id);
    vars = { ...vars, ...(await candidateVars(ctx.candidate_id, { recruiter: 'EPIL HR' })), portal_link: `${base}/candidates/${ctx.candidate_id}` };
  }
  if (ctx.requirement_id) {
    const r = await get('SELECT * FROM requirements WHERE id=?', ctx.requirement_id);
    if (r) vars = { ...vars, code: r.code, designation: r.designation, company: r.company, salary: r.salary_range || '', openings: r.openings, requirement_by: r.requirement_by, portal_link: `${base}/requirements/${r.id}` };
  }

  let employee = null;
  if (ctx.employee_id) {
    employee = await get('SELECT * FROM employees WHERE id=?', ctx.employee_id);
    if (employee) vars = { ...vars, employee: employee.name, emp_code: employee.emp_code, department: employee.department || '', designation: employee.designation || '', company: employee.company || '', portal_link: `${base}/me` };
  }
  if (ctx.leave_id) {
    const l = await get('SELECT l.*, t.name AS leave_type FROM leave_requests l LEFT JOIN leave_types t ON t.code=l.leave_code WHERE l.id=?', ctx.leave_id);
    if (l) vars = { ...vars, leave_type: l.leave_type || l.leave_code, from_date: l.from_date, to_date: l.to_date, days: l.days, reason: l.reason || '-', status: l.status, remark: l.decision_remark || '', portal_link: `${base}/hr/leave` };
  }
  if (ctx.payslip_id) {
    const p = await get('SELECT * FROM payslips WHERE id=?', ctx.payslip_id);
    if (p) vars = { ...vars, month: p.month, net: Math.round(p.net).toLocaleString('en-IN'), gross: Math.round(p.gross).toLocaleString('en-IN'), deductions: Math.round(p.deductions).toLocaleString('en-IN'), paid_days: p.paid_days, portal_link: `${base}/payslip/${p.id}` };
  }

  vars = { ...vars, ...(ctx.extra || {}) };

  // who receives it
  let targets = [];
  if (rule.recipient === 'employee' && employee) targets = [{ name: employee.name, email: employee.email, phone: employee.mobile }];
  if (rule.recipient === 'manager' && employee?.manager_user_id) targets = (await all('SELECT name, email, phone FROM users WHERE id=? AND active=1', employee.manager_user_id));
  if (rule.recipient === 'admin') targets = (await usersByRole('admin')).map((u) => ({ name: u.name, email: u.email, phone: u.phone }));
  if (rule.recipient === 'candidate' && candidate) targets = [{ name: candidate.name, email: candidate.email, phone: candidate.mobile }];
  if (rule.recipient === 'consultancy' && candidate) {
    if (!(await isConsultancy(candidate.source)) || !candidate.consultancy_email) {
      // direct source: nothing to email – close the step as Not Applicable
      if (rule.complete_step) await autoComplete(candidate.id, rule.complete_step, 'Not Applicable', 'Auto: source is not a consultancy');
      return { rule: rule.id, skipped: 'not a consultancy' };
    }
    targets = [{ name: candidate.source, email: candidate.consultancy_email }];
  }
  if (['approver', 'recruiter', 'hod', 'hr'].includes(rule.recipient)) targets = (await usersByRole(rule.recipient)).map((u) => ({ name: u.name, email: u.email, phone: u.phone }));

  const out = [];
  for (const t of targets) {
    const v = { ...vars, doer: t.name };
    const body = fillTemplate(tpl.body, v);
    const subject = fillTemplate(tpl.subject, v);
    let res;
    if (rule.channel === 'email') {
      if (!t.email || /@epil\.local$/i.test(t.email)) { out.push({ to: t.name, skipped: 'no email' }); continue; }
      res = await sendEmail({ to: t.email, subject, body, candidate_id: candidate?.id, employee_id: employee?.id, template: tpl.key, automation: String(rule.id), queueIfManual: true,
        related_type: ctx.requirement_id ? 'requirement' : null, related_id: ctx.requirement_id ?? null });
    } else {
      if (!t.phone) { out.push({ to: t.name, skipped: 'no mobile' }); continue; }
      res = await sendWhatsApp({ to: t.phone, body, candidate_id: candidate?.id, employee_id: employee?.id, template: tpl.key, automation: String(rule.id), queueIfManual: true });
    }
    if (res.status === 'sent' && rule.complete_step && candidate) await autoComplete(candidate.id, rule.complete_step, 'Sent', `Auto: ${tpl.name} sent`);
    out.push({ to: t.name, status: res.status });
  }
  return { rule: rule.id, out };
}

/** Complete a pending candidate step automatically (used when the action itself happened in the portal). */
export async function autoComplete(candidate_id, step_code, result, remark) {
  const inst = await get(`SELECT id FROM step_instances WHERE entity_type='candidate' AND entity_id=? AND step_code=? AND state='pending'`, candidate_id, step_code);
  if (!inst) return false;
  const { completeStep } = await import('./workflow.js');
  await completeStep(inst.id, { result, remark }, null);
  return true;
}

/** Called when a queued Outbox message is sent by hand: finish what the rule would have finished. */
export async function afterManualSend(message) {
  if (!message?.automation || !message.candidate_id) return;
  const rule = await get('SELECT * FROM automations WHERE id=?', Number(message.automation));
  if (rule?.complete_step) await autoComplete(message.candidate_id, rule.complete_step, 'Sent', 'Sent from Outbox');
}

// ---------------------------------------------------------------------------
// Cron jobs (Cloudflare cron trigger every hour / Node setInterval)
// ---------------------------------------------------------------------------
export async function runHourly() {
  const nowD = nowWall();
  const h = nowD.getUTCHours();
  const log = {};
  // 1) interview reminders for interviews in the next 18–30 hours
  const from = fmt(new Date(nowD.getTime() + 18 * 36e5));
  const to = fmt(new Date(nowD.getTime() + 30 * 36e5));
  const due = await all(`SELECT id FROM candidates WHERE status='Active' AND interview_reminded=0 AND interview_at BETWEEN ? AND ?`, from, to);
  for (const c of due) {
    await runAutomations('cron.interview_reminder', { candidate_id: c.id });
    await run('UPDATE candidates SET interview_reminded=1 WHERE id=?', c.id);
  }
  log.reminders = due.length;

  // HR: keep today's attendance fresh, and once a day (after 10 AM) close yesterday + alerts
  try {
    const { processAttendance } = await import('./hr/attendance.js');
    const today = now().slice(0, 10);
    await processAttendance({ from: today, to: today });
    if (h >= 10 && (await setting('last_hr_daily', '')) !== today) {
      await run(`INSERT INTO settings(key,value) VALUES('last_hr_daily', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, today);
      const y = new Date(nowD.getTime() - 864e5); const yday = fmt(y).slice(0, 10);
      await processAttendance({ from: yday, to: yday });
      log.hr = await hrDaily(yday);
    }
  } catch (e) { log.hr_error = e.message; }

  // 2) daily digest once a day at ~9 AM IST
  const today = now().slice(0, 10);
  if (h >= 9 && (await setting('last_digest_date', '')) !== today) {
    await run(`INSERT INTO settings(key,value) VALUES('last_digest_date', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, today);
    log.digest = await sendDigests();
  }
  return log;
}

async function sendDigests() {
  const rules = await all(`SELECT * FROM automations WHERE event='cron.daily_digest' AND enabled=1 AND channel='email'`);
  if (!rules.length) return 0;
  const tpl = await get('SELECT * FROM templates WHERE key=?', rules[0].template_key);
  const { listTasks } = await import('./workflow.js');
  const users = await all(`SELECT id, name, email, role FROM users WHERE active=1 AND email NOT LIKE '%@epil.local'`);
  const base = await setting('public_url', '');
  let sent = 0;
  for (const u of users) {
    const tasks = await listTasks({ user: u, scope: 'mine', when: 'due' });
    if (!tasks.length) continue;
    const overdue = tasks.filter((t) => t.overdue_hours > 0).length;
    const list = tasks.slice(0, 40).map((t) => `• ${t.record_code} ${t.title} – Step ${t.no} ${t.short_name}${t.overdue_hours > 0 ? ` (${Math.round(t.overdue_hours / 24)}d late)` : ''}`).join('\n');
    const v = { doer: u.name, overdue, due: tasks.length - overdue, list, today: now().slice(0, 10), portal_link: base };
    await sendEmail({ to: u.email, subject: fillTemplate(tpl.subject, v), body: fillTemplate(tpl.body, v), template: tpl.key, automation: String(rules[0].id) });
    sent++;
  }
  return sent;
}

async function hrDaily(date) {
  const rows = await all(`SELECT a.status, a.late_minutes, e.id, e.name, e.emp_code, e.department FROM attendance a JOIN employees e ON e.id=a.employee_id WHERE a.date=? AND e.status <> 'Left'`, date);
  if (!rows.length) return { employees: 0 };
  const absent = rows.filter((r) => r.status === 'A');
  const missed = rows.filter((r) => r.status === 'MP');
  const v = {
    date, present: rows.filter((r) => ['P', 'HD', 'WOP', 'HP'].includes(r.status)).length, absent: absent.length, leave: rows.filter((r) => r.status === 'L').length,
    missed: missed.length, late: rows.filter((r) => r.late_minutes > 0).length,
    absent_list: absent.map((r) => `• ${r.emp_code} ${r.name} (${r.department || '-'})`).join('\n') || '–',
    missed_list: missed.map((r) => `• ${r.emp_code} ${r.name}`).join('\n') || '–',
    portal_link: `${await setting('public_url', '')}/hr/attendance`,
  };
  await runAutomations('cron.absent_digest', { extra: v });
  for (const r of [...missed, ...absent].slice(0, 200)) {
    await runAutomations('cron.missed_punch', { employee_id: r.id, extra: { date, status_text: r.status === 'MP' ? 'a missed punch (only one punch)' : 'absent' } });
  }
  return { employees: rows.length, absent: absent.length, missed: missed.length };
}
