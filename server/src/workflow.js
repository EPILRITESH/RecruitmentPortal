// FMS-26 workflow engine: the "reminder machine" from the Google Sheet, rebuilt.
// Each record (requirement / candidate / onboarding) gets one row per step in step_instances.
// When a step is completed, the engine stamps the actual time, computes delay,
// applies the outcome (reject / hold / select ...) and activates the next step with a planned date.
import { all, get, run, now, fmt, parse, setting, nextCode, logActivity, tx } from './db.js';

// ---------------------------------------------------------------------------
// Step definitions (one clean list – fixes the swapped/blank names in the old STEPS tab)
// effect: next = step code to activate next (default: next non-optional step of the stage)
//         outcome = what happens to the record
// ---------------------------------------------------------------------------
const OK = (label = 'Done') => ({ value: label, label, color: 'green' });

export const STEP_DEFS = [
  // ---------------- INWARD (per requirement) ----------------
  { code: 'S01', no: 1, stage: 'inward', name: 'Checklist Updated & JD Prepared (HOD approval)', short_name: 'JD / Checklist', doer_role: 'recruiter', how: 'Portal – JD Generator', tat_days: 0,
    options: [OK('Done')] },
  { code: 'S02', no: 2, stage: 'inward', name: 'Enquiry Posted on Job Portals', short_name: 'Enquiry Posted', doer_role: 'recruiter', how: 'Work India / Apna / LinkedIn / Consultancy', tat_days: 3,
    options: [OK('Posted')], fields: [{ key: 'portals', label: 'Posted on (portals)', type: 'text' }] },
  { code: 'S03', no: 3, stage: 'inward', name: 'PC Verification (Inward)', short_name: 'PC Verify – Inward', doer_role: 'pc', how: 'Portal checklist', tat_days: 1,
    options: [OK('Verified'), { value: 'Issue Found', label: 'Issue Found', color: 'amber' }] },

  // ---------------- OUTWARD (per candidate) ----------------
  { code: 'S04', no: 4, stage: 'outward', name: 'Screening', short_name: 'Screening', doer_role: 'recruiter', how: 'Phone / AI Screening', tat_days: 0,
    options: [{ value: 'Accepted', label: 'Accepted', color: 'green' }, { value: 'Rejected', label: 'Rejected', color: 'red', outcome: 'reject' }] },
  { code: 'S05', no: 5, stage: 'outward', name: 'Interested or Not', short_name: 'Interested?', doer_role: 'recruiter', how: 'Call / WhatsApp', tat_days: 3,
    options: [{ value: 'Interested', label: 'Interested', color: 'green' }, { value: 'Not Interested', label: 'Not Interested', color: 'red', outcome: 'drop' }] },
  { code: 'S06', no: 6, stage: 'outward', name: 'Application Form Filled / Resume Attached', short_name: 'Form Filled', doer_role: 'recruiter', how: 'Candidate self-form link (auto)', tat_days: 4,
    options: [{ value: 'Form Filled', label: 'Form Filled', color: 'green' }, { value: 'Not Filled', label: 'Not Filled – Drop', color: 'red', outcome: 'drop' }] },
  { code: 'S07', no: 7, stage: 'outward', name: 'Interview Scheduled – Come or Not', short_name: 'Came for Interview?', doer_role: 'recruiter', how: 'WhatsApp reminder + call', tat_days: 2,
    options: [{ value: 'Came', label: 'Came', color: 'green' }, { value: 'Rescheduled', label: 'Rescheduled', color: 'amber', outcome: 'replan' }, { value: 'Not Came', label: 'Did not come', color: 'red', outcome: 'drop' }],
    fields: [{ key: 'interview_at', label: 'Interview date & time', type: 'datetime-local' }, { key: 'interviewer', label: 'Interviewer', type: 'text' }] },
  { code: 'S08', no: 8, stage: 'outward', name: 'Interview Result', short_name: 'Interview Result', doer_role: 'recruiter', how: 'Interviewer feedback form', tat_days: 10,
    options: [{ value: 'Selected', label: 'Selected', color: 'green', next: 'S11' }, { value: 'Hold', label: 'Hold → Ritesh Sir', color: 'amber', next: 'S09' },
      { value: 'Rejected', label: 'Rejected', color: 'red', outcome: 'reject' }, { value: 'Future Hold', label: 'Future Hold', color: 'slate', outcome: 'future_hold' }],
    fields: [{ key: 'rating', label: 'Interviewer rating (1-5)', type: 'number' }] },
  { code: 'S09', no: 9, stage: 'outward', name: 'Hold – Decision by Ritesh Sir', short_name: 'Hold Decision', doer_role: 'approver', how: 'Approval in portal', tat_days: 15, optional: 1,
    options: [{ value: '2nd Interview', label: 'Call for 2nd Interview', color: 'amber', next: 'S10' }, { value: 'Select', label: 'Select', color: 'green', next: 'S11' },
      { value: 'Reject', label: 'Reject', color: 'red', outcome: 'reject' }] },
  { code: 'S10', no: 10, stage: 'outward', name: '2nd Interview (Hold)', short_name: '2nd Interview', doer_role: 'recruiter', how: 'Interview', tat_days: 15, optional: 1,
    options: [{ value: 'Selected', label: 'Selected', color: 'green', next: 'S11' }, { value: 'Rejected', label: 'Rejected', color: 'red', outcome: 'reject' }] },
  { code: 'S11', no: 11, stage: 'outward', name: 'Final Select or Reject', short_name: 'Final Decision', doer_role: 'recruiter', how: 'Portal', tat_days: 6,
    options: [{ value: 'Selected', label: 'Final Selected', color: 'green', outcome: 'select' }, { value: 'Rejected', label: 'Rejected', color: 'red', outcome: 'reject' }],
    fields: [{ key: 'joining_date', label: 'Joining date', type: 'date', requiredFor: 'Selected' }, { key: 'offered_salary', label: 'Offered salary', type: 'text' }] },
  { code: 'S12', no: 12, stage: 'outward', name: 'Selection Email to Consultancy', short_name: 'Email Consultancy', doer_role: 'recruiter', how: 'Auto email', tat_days: 1,
    options: [OK('Sent'), { value: 'Not Applicable', label: 'Not Applicable (direct)', color: 'slate' }] },
  { code: 'S13', no: 13, stage: 'outward', name: 'PC Verification (Outward)', short_name: 'PC Verify – Outward', doer_role: 'pc', how: 'Portal checklist', tat_days: 1,
    options: [OK('Verified'), { value: 'Issue Found', label: 'Issue Found', color: 'amber' }] },

  // ---------------- ONBOARDING (anchored to joining date: tat = days from joining) ----------------
  { code: 'S14', no: 14, stage: 'onboarding', name: 'Pre-Onboarding (call, documents list, seat ready)', short_name: 'Pre-Onboarding', doer_role: 'hr', how: 'Checklist', tat_days: -2, anchor: 'joining',
    options: [OK('Done')] },
  { code: 'S15', no: 15, stage: 'onboarding', name: 'Day 1 – Joined? Orientation / Induction / HR Overview', short_name: 'Day 1 Joining', doer_role: 'hr', how: 'Checklist', tat_days: 0, anchor: 'joining',
    options: [{ value: 'Joined', label: 'Joined & Inducted', color: 'green', outcome: 'joined' }, { value: 'Not Joined', label: 'Did not join', color: 'red', outcome: 'not_joined' }] },
  { code: 'S16', no: 16, stage: 'onboarding', name: 'Joining Form & Documentation', short_name: 'Joining Docs', doer_role: 'hr', how: 'Checklist', tat_days: 2, anchor: 'joining',
    options: [OK('Done')] },
  { code: 'S17', no: 17, stage: 'onboarding', name: 'Company Accessories Provided (desk, ID, SIM, laptop)', short_name: 'Accessories', doer_role: 'hr', how: 'Checklist', tat_days: 2, anchor: 'joining',
    options: [OK('Done'), { value: 'Not Required', label: 'Not Required', color: 'slate' }] },
  { code: 'S18', no: 18, stage: 'onboarding', name: 'Training', short_name: 'Training', doer_role: 'hr', how: 'Buddy + HOD', tat_days: 6, anchor: 'joining',
    options: [OK('Done')] },
  { code: 'S19', no: 19, stage: 'onboarding', name: '6-Day Follow-up', short_name: '6-Day Follow-up', doer_role: 'hr', how: 'Call / Meeting', tat_days: 6, anchor: 'joining',
    options: [{ value: 'Working', label: 'Working fine', color: 'green' }, { value: 'Left', label: 'Left', color: 'red', outcome: 'left' }] },
  { code: 'S20', no: 20, stage: 'onboarding', name: 'Candidate Feedback Form', short_name: 'Feedback Form', doer_role: 'hr', how: 'Feedback link', tat_days: 7, anchor: 'joining',
    options: [OK('Filled'), { value: 'Not Filled', label: 'Not Filled', color: 'amber' }] },
  { code: 'S21', no: 21, stage: 'onboarding', name: 'MIS Scoring Added', short_name: 'MIS Scoring', doer_role: 'ea', how: 'MIS', tat_days: 8, anchor: 'joining',
    options: [OK('Done')] },
  { code: 'S22', no: 22, stage: 'onboarding', name: 'Placement Agency Payment', short_name: 'Agency Payment', doer_role: 'accounts', how: 'Accounts', tat_days: 75, anchor: 'joining',
    options: [OK('Paid'), { value: 'Not Applicable', label: 'Not Applicable', color: 'slate' }], fields: [{ key: 'amount', label: 'Amount paid (₹)', type: 'number' }] },
  { code: 'S23', no: 23, stage: 'onboarding', name: '30-Day Follow-up (still working?)', short_name: '30-Day Check', doer_role: 'hr', how: 'Call / HOD', tat_days: 30, anchor: 'joining',
    options: [{ value: 'Working', label: 'Working', color: 'green' }, { value: 'Left', label: 'Left', color: 'red', outcome: 'left' }] },
  { code: 'S24', no: 24, stage: 'onboarding', name: '60-Day Follow-up (still working?)', short_name: '60-Day Check', doer_role: 'hr', how: 'Call / HOD', tat_days: 60, anchor: 'joining',
    options: [{ value: 'Working', label: 'Working', color: 'green' }, { value: 'Left', label: 'Left', color: 'red', outcome: 'left' }] },
  { code: 'S25', no: 25, stage: 'onboarding', name: '90-Day Follow-up (retained?)', short_name: '90-Day Check', doer_role: 'hr', how: 'Call / HOD', tat_days: 90, anchor: 'joining',
    options: [{ value: 'Working', label: 'Retained', color: 'green', outcome: 'retained' }, { value: 'Left', label: 'Left', color: 'red', outcome: 'left' }] },
  { code: 'S26', no: 26, stage: 'onboarding', name: 'PC Verification (Onboarding)', short_name: 'PC Verify – Onboarding', doer_role: 'pc', how: 'Portal checklist', tat_days: 91, anchor: 'joining',
    options: [OK('Verified'), { value: 'Issue Found', label: 'Issue Found', color: 'amber' }] },
];

export function seedSteps() {
  for (const s of STEP_DEFS) {
    run(`INSERT INTO steps(code,no,stage,name,short_name,doer_role,how,tat_days,anchor,options,fields,optional)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(code) DO NOTHING`,
      s.code, s.no, s.stage, s.name, s.short_name, s.doer_role, s.how, s.tat_days, s.anchor || 'prev',
      JSON.stringify(s.options), JSON.stringify(s.fields || []), s.optional || 0);
  }
}

export function getSteps(stage) {
  const rows = stage ? all('SELECT * FROM steps WHERE stage=? AND active=1 ORDER BY no', stage) : all('SELECT * FROM steps WHERE active=1 ORDER BY no');
  return rows.map((r) => ({ ...r, options: JSON.parse(r.options || '[]'), fields: JSON.parse(r.fields || '[]') }));
}
export const getStep = (code) => getSteps().find((s) => s.code === code);

// ---------------------------------------------------------------------------
// Working calendar (Sunday + holidays off, office 09:00 – 19:00 like the sheet's 0.375 / 19)
// ---------------------------------------------------------------------------
function calendar() {
  const startH = Number(setting('work_start_hour', 9));
  const endH = Number(setting('work_end_hour', 19));
  const weekOff = String(setting('weekly_off', '0')).split(',').map(Number); // 0 = Sunday
  const holidays = new Set(all('SELECT date FROM holidays').map((h) => h.date));
  const isOff = (d) => weekOff.includes(d.getDay()) || holidays.has(fmt(d).slice(0, 10));
  return { startH, endH, isOff };
}

export function addWorkingDays(base, days) {
  const { startH, endH, isOff } = calendar();
  const d = new Date(base);
  if (days <= 0) {
    // same working day, end of office time
    if (d.getHours() >= endH || isOff(d)) {
      do d.setDate(d.getDate() + 1); while (isOff(d));
    }
    d.setHours(endH, 0, 0, 0);
    return d;
  }
  let left = Math.ceil(days);
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (!isOff(d)) left--;
  }
  if (d.getHours() < startH) d.setHours(startH, 0, 0, 0);
  if (d.getHours() >= endH) d.setHours(endH, 0, 0, 0);
  return d;
}

export function anchoredDate(joining, offsetDays) {
  const { endH, isOff } = calendar();
  const d = parse(joining.length === 10 ? `${joining} 00:00:00` : joining);
  d.setDate(d.getDate() + offsetDays);
  const dir = offsetDays < 0 ? -1 : 1;
  let guard = 0;
  while (isOff(d) && guard++ < 10) d.setDate(d.getDate() + dir);
  d.setHours(endH, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
const ENTITY_TABLE = { requirement: 'requirements', candidate: 'candidates', onboarding: 'onboardings' };
const STAGE_ENTITY = { inward: 'requirement', outward: 'candidate', onboarding: 'onboarding' };

export function activateStep(entity_type, entity_id, step_code, base = new Date()) {
  const step = getStep(step_code);
  if (!step) return;
  let planned;
  if (step.anchor === 'joining') {
    const onb = get('SELECT joining_date FROM onboardings WHERE id=?', entity_id);
    planned = onb?.joining_date ? anchoredDate(onb.joining_date, step.tat_days) : addWorkingDays(base, 1);
  } else {
    planned = addWorkingDays(base, step.tat_days);
  }
  run(`INSERT INTO step_instances(entity_type, entity_id, step_code, planned_at, state, created_at)
       VALUES(?,?,?,?, 'pending', ?)
       ON CONFLICT(entity_type, entity_id, step_code) DO UPDATE SET state='pending', planned_at=excluded.planned_at, actual_at=NULL, result=NULL`,
    entity_type, entity_id, step_code, fmt(planned), now());
}

export function startWorkflow(entity_type, entity_id) {
  const stage = Object.keys(STAGE_ENTITY).find((k) => STAGE_ENTITY[k] === entity_type);
  const steps = getSteps(stage);
  if (stage === 'onboarding') {
    for (const s of steps) activateStep(entity_type, entity_id, s.code);
  } else {
    activateStep(entity_type, entity_id, steps[0].code);
  }
}

function nextDefaultStep(step) {
  const steps = getSteps(step.stage);
  return steps.find((s) => s.no > step.no && !s.optional);
}

function cancelPending(entity_type, entity_id) {
  run(`UPDATE step_instances SET state='cancelled' WHERE entity_type=? AND entity_id=? AND state='pending'`, entity_type, entity_id);
}

/** Complete a pending step. Returns updated instance. */
export function completeStep(instanceId, { result, remark, data = {} }, user) {
  return tx(() => {
    const inst = get('SELECT * FROM step_instances WHERE id=?', instanceId);
    if (!inst) throw httpError(404, 'Step not found');
    if (inst.state !== 'pending') throw httpError(400, 'This step is already ' + inst.state);
    const step = getStep(inst.step_code);
    const opt = step.options.find((o) => o.value === result);
    if (!opt) throw httpError(400, 'Choose a valid result');
    for (const f of step.fields) {
      if (f.requiredFor === result && !data[f.key]) throw httpError(400, `${f.label} is required`);
    }

    const { entity_type, entity_id } = inst;
    applyFieldData(entity_type, entity_id, data);

    // Rescheduled interview: keep the step open with a new planned date
    if (opt.outcome === 'replan') {
      const when = data.interview_at ? parse(data.interview_at.replace('T', ' ') + (data.interview_at.length === 16 ? ':00' : '')) : addWorkingDays(new Date(), 2);
      run('UPDATE step_instances SET planned_at=?, remark=?, follow_ups=follow_ups+1, last_follow_up=? WHERE id=?', fmt(when), remark ?? null, now(), inst.id);
      logActivity(entity_type, entity_id, `${step.short_name}: Rescheduled`, remark, user?.id);
      return get('SELECT * FROM step_instances WHERE id=?', inst.id);
    }

    const actual = new Date();
    const planned = parse(inst.planned_at);
    const delay = planned ? Math.max(0, (actual - planned) / 36e5) : 0;
    run(`UPDATE step_instances SET state='done', actual_at=?, result=?, remark=?, data=?, delay_hours=?, done_by=? WHERE id=?`,
      fmt(actual), result, remark ?? null, JSON.stringify(data), Math.round(delay * 10) / 10, user?.id ?? null, inst.id);
    logActivity(entity_type, entity_id, `${step.short_name}: ${result}`, remark, user?.id);

    applyOutcome(step, opt, inst, data, user);

    // activate next
    if (!['reject', 'drop', 'future_hold', 'not_joined', 'left'].includes(opt.outcome) && step.anchor !== 'joining') {
      const next = opt.next ? getStep(opt.next) : nextDefaultStep(step);
      if (next) {
        activateStep(entity_type, entity_id, next.code, actual);
        if (entity_type === 'candidate') run('UPDATE candidates SET stage=? WHERE id=?', next.short_name, entity_id);
        // S07 planned date = the interview date when known
        if (next.code === 'S07') {
          const c = get('SELECT interview_at FROM candidates WHERE id=?', entity_id);
          if (c?.interview_at) run(`UPDATE step_instances SET planned_at=? WHERE entity_type='candidate' AND entity_id=? AND step_code='S07'`, c.interview_at, entity_id);
        }
      } else if (entity_type === 'candidate' && step.code === 'S13') {
        run(`UPDATE candidates SET stage='Handed to Onboarding' WHERE id=?`, entity_id);
      }
    }
    return get('SELECT * FROM step_instances WHERE id=?', inst.id);
  });
}

function applyFieldData(entity_type, entity_id, data) {
  if (entity_type === 'candidate') {
    const map = { interview_at: 'interview_at', interviewer: 'interviewer', joining_date: 'joining_date', offered_salary: 'offered_salary' };
    for (const [k, col] of Object.entries(map)) {
      if (data[k]) {
        let v = data[k];
        if (k === 'interview_at') v = v.replace('T', ' ') + (v.length === 16 ? ':00' : '');
        run(`UPDATE candidates SET ${col}=? WHERE id=?`, v, entity_id);
      }
    }
  }
  if (entity_type === 'onboarding' && data.amount) {
    run('UPDATE onboardings SET agency_payment=? WHERE id=?', Number(data.amount), entity_id);
  }
}

function applyOutcome(step, opt, inst, data, user) {
  const { entity_type, entity_id } = inst;
  switch (opt.outcome) {
    case 'reject':
    case 'drop':
    case 'future_hold': {
      const status = opt.outcome === 'reject' ? 'Rejected' : opt.outcome === 'drop' ? 'Dropped' : 'Future Hold';
      run('UPDATE candidates SET status=?, stage=? WHERE id=?', status, `${status} at ${step.short_name}`, entity_id);
      cancelPending(entity_type, entity_id);
      break;
    }
    case 'select': {
      run(`UPDATE candidates SET status='Selected', stage='Selected' WHERE id=?`, entity_id);
      createOnboarding(entity_id, data.joining_date, user);
      break;
    }
    case 'joined': {
      const onb = get('SELECT * FROM onboardings WHERE id=?', entity_id);
      run(`UPDATE onboardings SET status='Joined' WHERE id=?`, entity_id);
      run(`UPDATE candidates SET status='Joined' WHERE id=?`, onb.candidate_id);
      const c = get('SELECT requirement_id FROM candidates WHERE id=?', onb.candidate_id);
      if (c?.requirement_id) {
        run('UPDATE requirements SET filled=filled+1 WHERE id=?', c.requirement_id);
        const r = get('SELECT filled, openings FROM requirements WHERE id=?', c.requirement_id);
        if (r.filled >= r.openings) {
          run(`UPDATE requirements SET status='Closed', closed_at=? WHERE id=?`, now(), c.requirement_id);
          cancelPending('requirement', c.requirement_id);
        }
      }
      break;
    }
    case 'not_joined':
    case 'left': {
      const onb = get('SELECT * FROM onboardings WHERE id=?', entity_id);
      const st = opt.outcome === 'left' ? 'Left' : 'Not Joined';
      run('UPDATE onboardings SET status=?, left_on=?, left_reason=? WHERE id=?', st, now(), inst.remark ?? null, entity_id);
      run('UPDATE candidates SET status=? WHERE id=?', st, onb.candidate_id);
      // keep payment + PC verification open, cancel the rest
      run(`UPDATE step_instances SET state='cancelled' WHERE entity_type='onboarding' AND entity_id=? AND state='pending' AND step_code NOT IN ('S22','S26')`, entity_id);
      break;
    }
    case 'retained':
      run(`UPDATE onboardings SET status='Retained 90' WHERE id=?`, entity_id);
      break;
    default:
  }
}

export function createOnboarding(candidate_id, joining_date, user) {
  const exists = get('SELECT id FROM onboardings WHERE candidate_id=?', candidate_id);
  if (exists) return exists.id;
  const code = nextCode('onboardings', 'ONB', 144);
  const r = run(`INSERT INTO onboardings(code, candidate_id, joining_date, checklist, status, created_at) VALUES(?,?,?,?, 'Pre-Onboarding', ?)`,
    code, candidate_id, joining_date || null, '{}', now());
  const id = Number(r.lastInsertRowid);
  startWorkflow('onboarding', id);
  logActivity('onboarding', id, 'Onboarding created', `From candidate #${candidate_id}`, user?.id);
  return id;
}

/** Re-plan anchored onboarding steps when joining date changes */
export function replanOnboarding(onboarding_id) {
  const onb = get('SELECT joining_date FROM onboardings WHERE id=?', onboarding_id);
  if (!onb?.joining_date) return;
  for (const s of getSteps('onboarding')) {
    run(`UPDATE step_instances SET planned_at=? WHERE entity_type='onboarding' AND entity_id=? AND step_code=? AND state='pending'`,
      fmt(anchoredDate(onb.joining_date, s.tat_days)), onboarding_id, s.code);
  }
}

// ---------------------------------------------------------------------------
// Task list (replaces Studio-2.0 + Rescue Sheet)
// ---------------------------------------------------------------------------
export function listTasks({ user, scope = 'mine', when = 'due', stage, q } = {}) {
  const where = [`si.state='pending'`];
  const params = [];
  if (scope === 'mine' && user && user.role !== 'admin') {
    where.push('(s.doer_user_id = ? OR (s.doer_user_id IS NULL AND s.doer_role = ?))');
    params.push(user.id, user.role);
  }
  if (stage) { where.push('s.stage = ?'); params.push(stage); }
  const endToday = fmt(new Date(new Date().setHours(23, 59, 59, 0)));
  if (when === 'due') { where.push('si.planned_at <= ?'); params.push(endToday); }
  if (when === 'overdue') { where.push('si.planned_at < ?'); params.push(now()); }
  if (when === 'upcoming') { where.push('si.planned_at > ?'); params.push(endToday); }

  const rows = all(`
    SELECT si.*, s.name AS step_name, s.short_name, s.stage, s.doer_role, s.doer_user_id, s.options, s.fields, s.no,
      u.name AS doer_name,
      COALESCE(r.code, c.code, o.code) AS record_code,
      COALESCE(r.designation || ' – ' || r.company, c.name, oc.name) AS title,
      COALESCE(c.mobile, oc.mobile) AS mobile,
      COALESCE(cr.designation, ocr.designation, r.designation) AS designation,
      COALESCE(cr.company, ocr.company, r.company) AS company,
      COALESCE(c.source, oc.source) AS source,
      COALESCE(c.id, oc.id) AS candidate_id
    FROM step_instances si
    JOIN steps s ON s.code = si.step_code
    LEFT JOIN users u ON u.id = s.doer_user_id
    LEFT JOIN requirements r ON si.entity_type='requirement' AND r.id = si.entity_id
    LEFT JOIN candidates c ON si.entity_type='candidate' AND c.id = si.entity_id
    LEFT JOIN requirements cr ON cr.id = c.requirement_id
    LEFT JOIN onboardings o ON si.entity_type='onboarding' AND o.id = si.entity_id
    LEFT JOIN candidates oc ON oc.id = o.candidate_id
    LEFT JOIN requirements ocr ON ocr.id = oc.requirement_id
    WHERE ${where.join(' AND ')}
    ORDER BY si.planned_at ASC LIMIT 1000`, ...params);
  const nowD = new Date();
  let out = rows.map((r) => ({
    ...r,
    options: JSON.parse(r.options || '[]'),
    fields: JSON.parse(r.fields || '[]'),
    overdue_hours: r.planned_at ? Math.max(0, Math.round((nowD - parse(r.planned_at)) / 36e5)) : 0,
  }));
  if (q) {
    const ql = q.toLowerCase();
    out = out.filter((t) => [t.title, t.record_code, t.mobile, t.step_name].some((v) => v && String(v).toLowerCase().includes(ql)));
  }
  return out;
}

/** Full step tracker for one record (done + pending + not-reached) */
export function tracker(entity_type, entity_id) {
  const stage = Object.keys(STAGE_ENTITY).find((k) => STAGE_ENTITY[k] === entity_type);
  const steps = getSteps(stage);
  const inst = all(`SELECT si.*, u.name AS done_by_name FROM step_instances si LEFT JOIN users u ON u.id = si.done_by
                    WHERE entity_type=? AND entity_id=?`, entity_type, entity_id);
  return steps.map((s) => {
    const i = inst.find((x) => x.step_code === s.code);
    return { ...s, instance: i ? { ...i, data: i.data ? JSON.parse(i.data) : {} } : null };
  });
}

export function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export { ENTITY_TABLE };
