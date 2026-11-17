// MIS dashboard (replaces Looker Studio) + Plan vs Actual FMS grid
import { Router } from 'express';
import { all, get, now, parse, fmt } from '../db.js';
import { requireAuth } from '../auth.js';
import { getSteps } from '../workflow.js';

const r = Router();
r.use(requireAuth);

// ISO week like the sheet: WEEK-5 = 26/01/26 to 01/02/26 (Monday–Sunday)
export function isoWeek(dateStr) {
  const d = parse(String(dateStr).slice(0, 10));
  const day = (d.getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - day);
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((thursday - yearStart) / 864e5 + 1) / 7);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const f = (x) => `${String(x.getUTCDate()).padStart(2, '0')}/${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCFullYear()).slice(2)}`;
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, label: `WEEK-${week}`, range: `${f(monday)} to ${f(sunday)}`, start: fmt(monday).slice(0, 10) };
}
const monthOf = (s) => {
  const d = parse(String(s).slice(0, 10));
  return { key: fmt(d).slice(0, 7), label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }), range: '' };
};

function filters(q) {
  const from = q.from || '2000-01-01';
  const to = `${q.to || '2999-12-31'} 23:59:59`;
  return { from, to, company: q.company || null, source: q.source || null };
}

// entity → company / source / name lookup used to filter every count
const ENT = `ent AS (
  SELECT 'requirement' AS et, r.id AS eid, r.company, NULL AS source, r.designation, r.code, r.designation || ' – ' || r.company AS name FROM requirements r
  UNION ALL SELECT 'candidate', c.id, r.company, c.source, r.designation, c.code, c.name FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id
  UNION ALL SELECT 'onboarding', o.id, r.company, c.source, r.designation, o.code, c.name FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id)`;
const ENT_FILTER = `(? IS NULL OR e.company=?) AND (? IS NULL OR e.source=? OR e.et='requirement')`;

r.get('/mis', async (req, res) => {
  const { from, to, company, source } = filters(req.query);
  const group = req.query.group === 'month' ? 'month' : 'week';
  const fp = [company, company, source, source];

  // ---- Plan vs Actual per step (plan = planned date in range, actual = done in range)
  const stepRows = await all(`WITH ${ENT}
    SELECT si.step_code AS code,
      SUM(CASE WHEN si.planned_at BETWEEN ? AND ? AND si.state NOT IN ('cancelled','skipped') THEN 1 ELSE 0 END) AS plan,
      SUM(CASE WHEN si.state='done' AND si.actual_at BETWEEN ? AND ? THEN 1 ELSE 0 END) AS actual,
      SUM(CASE WHEN si.state='done' AND si.actual_at BETWEEN ? AND ? AND COALESCE(si.delay_hours,0) <= 0 THEN 1 ELSE 0 END) AS on_time,
      SUM(CASE WHEN si.state='pending' AND si.planned_at <= ? AND si.planned_at < ? THEN 1 ELSE 0 END) AS pending
    FROM step_instances si JOIN ent e ON e.et=si.entity_type AND e.eid=si.entity_id
    WHERE ${ENT_FILTER} GROUP BY si.step_code`, from, to, from, to, from, to, to, now(), ...fp);
  const results = await all(`WITH ${ENT}
    SELECT si.step_code AS code, si.result, COUNT(*) n FROM step_instances si JOIN ent e ON e.et=si.entity_type AND e.eid=si.entity_id
    WHERE si.state='done' AND si.actual_at BETWEEN ? AND ? AND ${ENT_FILTER} GROUP BY si.step_code, si.result`, from, to, ...fp);
  const res_ = (code, ...vals) => results.filter((x) => x.code === code && (!vals.length || vals.includes(x.result))).reduce((a, b) => a + b.n, 0);
  const steps = (await getSteps()).map((s) => {
    const row = stepRows.find((x) => x.code === s.code) || { plan: 0, actual: 0, on_time: 0, pending: 0 };
    return { code: s.code, no: s.no, name: s.short_name, stage: s.stage, ...row, pct: row.plan ? Math.round((row.actual / row.plan) * 100) : null };
  });

  // ---- headline actuals (Looker scorecards)
  const one = async (sql, ...p) => (await get(sql, ...p))?.n || 0;
  const inward = await one(`SELECT COUNT(*) n FROM requirements WHERE created_at BETWEEN ? AND ? AND (? IS NULL OR company=?)`, from, to, company, company);
  const inwardPending = await one(`SELECT COUNT(*) n FROM requirements WHERE status IN ('Open','On Hold') AND (? IS NULL OR company=?)`, company, company);
  const outward = await one(`SELECT COUNT(*) n FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?)`, from, to, ...fp);
  const actual = {
    inward, inward_pending: inwardPending, outward,
    screening: res_('S04'), screening_accepted: res_('S04', 'Accepted'),
    interview: res_('S07', 'Came'), selection: res_('S11', 'Selected'),
    retention: res_('S25', 'Working'), d30: res_('S23', 'Working'), d60: res_('S24', 'Working'),
    joined: res_('S15', 'Joined'), not_joined: res_('S15', 'Not Joined'),
    hr_orientation: res_('S15', 'Joined'), accessories: res_('S17'), mis_scoring: res_('S21'), training: res_('S18'),
    joining_docs: res_('S16'), feedback: res_('S20'), pre_onboarding: res_('S14'), agency_payment: res_('S22', 'Paid'),
  };
  const planOf = (code) => steps.find((s) => s.code === code)?.plan || 0;
  const plan = {
    screening: planOf('S04'), interview: planOf('S07'), selection: planOf('S11'), outward_steps: steps.filter((s) => s.stage === 'outward').reduce((a, b) => a + b.plan, 0),
    hr_orientation: planOf('S15'), accessories: planOf('S17'), mis_scoring: planOf('S21'), retention: planOf('S25'),
  };

  // ---- 5×3: period × platform → outward / interview / selection
  const daily = await all(`SELECT 'outward' AS m, substr(c.created_at,1,10) AS d, c.source, COUNT(*) n FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id
      WHERE c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) GROUP BY d, c.source
    UNION ALL
    SELECT CASE si.step_code WHEN 'S07' THEN 'interview' ELSE 'selection' END, substr(si.actual_at,1,10), c.source, COUNT(*)
      FROM step_instances si JOIN candidates c ON si.entity_type='candidate' AND c.id=si.entity_id LEFT JOIN requirements r ON r.id=c.requirement_id
      WHERE si.state='done' AND ((si.step_code='S07' AND si.result='Came') OR (si.step_code='S11' AND si.result='Selected'))
        AND si.actual_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) GROUP BY 1, 2, 3`, from, to, ...fp, from, to, ...fp);
  const periods = {};
  const sources = new Set();
  for (const x of daily) {
    const p = group === 'month' ? monthOf(x.d) : isoWeek(x.d);
    periods[p.key] ||= { ...p, cells: {} };
    const cell = (periods[p.key].cells[x.source] ||= { outward: 0, interview: 0, selection: 0 });
    cell[x.m] += x.n;
    sources.add(x.source);
  }
  const matrix = { group, sources: [...sources].sort(), periods: Object.values(periods).sort((a, b) => (a.key < b.key ? 1 : -1)) };

  // ---- placement summary per platform
  const placement = await all(`SELECT c.source,
      COUNT(*) AS outward,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='candidate' AND si.entity_id=c.id AND si.step_code='S07' AND si.result='Came') THEN 1 ELSE 0 END) AS interview,
      SUM(CASE WHEN c.status IN ('Selected','Joined','Not Joined','Left') THEN 1 ELSE 0 END) AS selection,
      SUM(CASE WHEN c.status IN ('Joined','Left') THEN 1 ELSE 0 END) AS joined,
      SUM(CASE WHEN c.status='Left' THEN 1 ELSE 0 END) AS left_count,
      COALESCE(SUM(o.agency_payment),0) AS agency_payment
    FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id LEFT JOIN onboardings o ON o.candidate_id=c.id
    WHERE c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?)
    GROUP BY c.source ORDER BY outward DESC`, from, to, ...fp);
  const selectedNames = await all(`SELECT c.id, c.name, c.source, c.status, r.designation, r.company, o.agency_payment FROM candidates c
    LEFT JOIN requirements r ON r.id=c.requirement_id LEFT JOIN onboardings o ON o.candidate_id=c.id
    WHERE c.status IN ('Selected','Joined','Not Joined','Left') AND c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) ORDER BY c.source, c.name`, from, to, ...fp);
  const spend = await all(`SELECT platform, SUM(amount) amount FROM portal_payments WHERE COALESCE(posted_date, created_at) BETWEEN ? AND ? GROUP BY platform`, from, to);
  for (const p of placement) {
    p.names = selectedNames.filter((x) => x.source === p.source);
    p.portal_spend = spend.find((x) => x.platform === p.source)?.amount || 0;
  }

  // ---- retention by joining month, with names
  const onb = await all(`SELECT o.id, o.code, o.status, o.joining_date, c.name, c.source, r.designation, r.company,
      (SELECT result FROM step_instances WHERE entity_type='onboarding' AND entity_id=o.id AND step_code='S23' AND state='done') AS d30,
      (SELECT result FROM step_instances WHERE entity_type='onboarding' AND entity_id=o.id AND step_code='S24' AND state='done') AS d60,
      (SELECT result FROM step_instances WHERE entity_type='onboarding' AND entity_id=o.id AND step_code='S25' AND state='done') AS d90
    FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id
    WHERE COALESCE(o.joining_date, o.created_at) BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?)
    ORDER BY COALESCE(o.joining_date, o.created_at)`, from, to, ...fp);
  const retention = {};
  for (const o of onb) {
    const m = monthOf(o.joining_date || now());
    retention[m.key] ||= { ...m, people: [] };
    retention[m.key].people.push(o);
  }

  res.json({ from, to, actual, plan, steps, matrix, placement, retention: Object.values(retention).sort((a, b) => (a.key < b.key ? 1 : -1)) });
});

// Drill-down lists with names for any scorecard / cell
r.get('/mis/list', async (req, res) => {
  const { from, to, company, source } = filters(req.query);
  const fp = [company, company, source, source];
  const metric = req.query.metric || 'outward';
  const STEP_METRIC = { screening: ['S04', null], interview: ['S07', 'Came'], selection: ['S11', 'Selected'], retention: ['S25', 'Working'], d30: ['S23', 'Working'], d60: ['S24', 'Working'],
    hr_orientation: ['S15', 'Joined'], accessories: ['S17', null], mis_scoring: ['S21', null], training: ['S18', null], joining_docs: ['S16', null], feedback: ['S20', null], pre_onboarding: ['S14', null] };
  let rows;
  if (metric === 'outward') {
    rows = await all(`SELECT c.id, c.code, c.name, c.mobile, c.source, c.status, c.stage, c.created_at AS date, r.designation, r.company, 'candidate' AS et
      FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id
      WHERE c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) ORDER BY c.created_at DESC LIMIT 1000`, from, to, ...fp);
  } else if (metric === 'inward' || metric === 'inward_pending') {
    rows = await all(`SELECT id, code, designation || ' – ' || company AS name, requirement_by AS source, status, company, designation, request_date AS date, 'requirement' AS et
      FROM requirements WHERE ${metric === 'inward' ? 'created_at BETWEEN ? AND ?' : `status IN ('Open','On Hold') AND ? IS NOT NULL AND ? IS NOT NULL`} AND (? IS NULL OR company=?) ORDER BY id DESC`, from, to, company, company);
  } else if (STEP_METRIC[metric] || /^S\d\d$/.test(metric)) {
    const [code, result] = STEP_METRIC[metric] || [metric, null];
    const plan = req.query.kind === 'plan';
    rows = await all(`WITH ${ENT}
      SELECT si.entity_id AS id, e.code, e.name, e.source, e.company, e.designation, ${plan ? 'si.planned_at' : 'si.actual_at'} AS date, si.result AS status, si.state, si.planned_at, si.actual_at, si.delay_hours, si.entity_type AS et
      FROM step_instances si JOIN ent e ON e.et=si.entity_type AND e.eid=si.entity_id
      WHERE si.step_code=? AND ${plan ? `si.planned_at BETWEEN ? AND ? AND si.state NOT IN ('cancelled','skipped')` : `si.state='done' AND si.actual_at BETWEEN ? AND ?`}
        ${result && !plan ? 'AND si.result=?' : ''} AND ${ENT_FILTER} ORDER BY date DESC LIMIT 1000`,
    code, from, to, ...(result && !plan ? [result] : []), ...fp);
  } else return res.status(400).json({ error: 'Unknown metric' });
  res.json(rows);
});

// Plan vs Actual grid – the FMS sheet view (rows = records, columns = steps)
r.get('/fms/:stage', async (req, res) => {
  const stage = req.params.stage;
  const steps = await getSteps(stage);
  const { from, to, company, source } = filters(req.query);
  const status = req.query.status || 'open';
  const limit = Math.min(Number(req.query.limit) || 200, 500);
  let base;
  if (stage === 'inward') {
    base = { sql: `SELECT id, code, designation || ' – ' || company AS name, requirement_by AS source, company, designation, status, created_at FROM requirements
      WHERE created_at BETWEEN ? AND ? AND (? IS NULL OR company=?) ${status === 'open' ? `AND status IN ('Open','On Hold')` : ''} ORDER BY id DESC LIMIT ${limit}`, p: [from, to, company, company], et: 'requirement' };
  } else if (stage === 'outward') {
    base = { sql: `SELECT c.id, c.code, c.name, c.source, r.company, r.designation, c.status, c.created_at FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id
      WHERE c.created_at BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) ${status === 'open' ? `AND c.status IN ('Active','Selected')` : ''} ORDER BY c.id DESC LIMIT ${limit}`, p: [from, to, company, company, source, source], et: 'candidate' };
  } else {
    base = { sql: `SELECT o.id, o.code, c.name, c.source, r.company, r.designation, o.status, o.joining_date AS created_at FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id
      WHERE COALESCE(o.joining_date,o.created_at) BETWEEN ? AND ? AND (? IS NULL OR r.company=?) AND (? IS NULL OR c.source=?) ${status === 'open' ? `AND o.status IN ('Pre-Onboarding','Joined')` : ''} ORDER BY o.id DESC LIMIT ${limit}`, p: [from, to, company, company, source, source], et: 'onboarding' };
  }
  const rows = await all(base.sql, ...base.p);
  const inst = await all(`SELECT id, entity_id, step_code, planned_at, actual_at, state, result, delay_hours FROM step_instances
    WHERE entity_type=? AND entity_id IN (SELECT id FROM (${base.sql}))`, base.et, ...base.p);
  const byEnt = {};
  for (const i of inst) (byEnt[i.entity_id] ||= {})[i.step_code] = i;
  res.json({ steps: steps.map((s) => ({ code: s.code, no: s.no, name: s.short_name, options: s.options, fields: s.fields, full: s.name })), rows: rows.map((x) => ({ ...x, cells: byEnt[x.id] || {} })), entity_type: base.et });
});

export default r;
