// Dashboard + MIS reports (replaces Looker Studio, PORTAL SUMMARY, RETENTION, Conversion Rate tabs)
import { Router } from 'express';
import { all, get, now } from '../db.js';
import { requireAuth } from '../auth.js';
import { listTasks } from '../workflow.js';

const r = Router();
r.use(requireAuth);

const MONTH = `strftime('%Y-%m', c.created_at)`;

export async function dashboardData({ from, to }) {
  const f = from || '2000-01-01';
  const t = (to || '2999-12-31') + ' 23:59:59';
  const nowS = now();
  const monthStart = nowS.slice(0, 7) + '-01';

  const kpis = {
    open_requirements: (await get(`SELECT COUNT(*) n FROM requirements WHERE status='Open'`)).n,
    open_positions: (await get(`SELECT COALESCE(SUM(openings - filled),0) n FROM requirements WHERE status='Open'`)).n,
    active_candidates: (await get(`SELECT COUNT(*) n FROM candidates WHERE status='Active'`)).n,
    interviews_today: (await get(`SELECT COUNT(*) n FROM candidates WHERE status='Active' AND substr(interview_at,1,10)=?`, nowS.slice(0, 10))).n,
    overdue_tasks: (await get(`SELECT COUNT(*) n FROM step_instances WHERE state='pending' AND planned_at < ?`, nowS)).n,
    pending_tasks: (await get(`SELECT COUNT(*) n FROM step_instances WHERE state='pending' AND planned_at <= ?`, nowS.slice(0, 10) + ' 23:59:59')).n,
    sourced_period: (await get(`SELECT COUNT(*) n FROM candidates c WHERE c.created_at BETWEEN ? AND ?`, f, t)).n,
    selected_period: (await get(`SELECT COUNT(*) n FROM step_instances si WHERE si.step_code='S11' AND si.result='Selected' AND si.actual_at BETWEEN ? AND ?`, f, t)).n,
    joined_this_month: (await get(`SELECT COUNT(*) n FROM step_instances WHERE step_code='S15' AND result='Joined' AND actual_at >= ?`, monthStart)).n,
    on_hold_ritesh_sir: (await get(`SELECT COUNT(*) n FROM step_instances WHERE step_code='S09' AND state='pending'`)).n,
    avg_time_to_hire_days: Math.round(((await get(`SELECT AVG(julianday(si.actual_at) - julianday(c.created_at)) d FROM step_instances si JOIN candidates c ON c.id=si.entity_id
                              WHERE si.entity_type='candidate' AND si.step_code='S11' AND si.result='Selected' AND si.actual_at BETWEEN ? AND ?`, f, t)).d || 0) * 10) / 10,
  };

  const stepCount = async (code, results) => (await get(`SELECT COUNT(*) n FROM step_instances si JOIN candidates c ON c.id=si.entity_id AND si.entity_type='candidate'
      WHERE si.step_code=? AND si.state='done' AND si.result IN (${results.map(() => '?').join(',')}) AND c.created_at BETWEEN ? AND ?`, code, ...results, f, t)).n;
  const funnel = [
    { stage: 'Sourced (Outward)', value: kpis.sourced_period },
    { stage: 'Screening Accepted', value: await stepCount('S04', ['Accepted']) },
    { stage: 'Interested', value: await stepCount('S05', ['Interested']) },
    { stage: 'Form Filled', value: await stepCount('S06', ['Form Filled']) },
    { stage: 'Came for Interview', value: await stepCount('S07', ['Came']) },
    { stage: 'Selected', value: await stepCount('S11', ['Selected']) },
    { stage: 'Joined', value: (await get(`SELECT COUNT(*) n FROM step_instances si JOIN onboardings o ON o.id=si.entity_id AND si.entity_type='onboarding' JOIN candidates c ON c.id=o.candidate_id
        WHERE si.step_code='S15' AND si.result='Joined' AND c.created_at BETWEEN ? AND ?`, f, t)).n },
  ];

  const sources = await all(`SELECT c.source,
      COUNT(*) AS outward,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='candidate' AND si.entity_id=c.id AND si.step_code='S07' AND si.result='Came') THEN 1 ELSE 0 END) AS interviews,
      SUM(CASE WHEN c.status IN ('Selected','Joined','Not Joined','Left') THEN 1 ELSE 0 END) AS selected,
      SUM(CASE WHEN c.status IN ('Joined','Left') THEN 1 ELSE 0 END) AS joined
    FROM candidates c WHERE c.created_at BETWEEN ? AND ? GROUP BY c.source ORDER BY outward DESC`, f, t);
  const spend = await all(`SELECT platform, SUM(amount) amount FROM portal_payments WHERE COALESCE(posted_date, created_at) BETWEEN ? AND ? GROUP BY platform`, f, t);
  const agency = await all(`SELECT c.source AS platform, SUM(o.agency_payment) amount FROM onboardings o JOIN candidates c ON c.id=o.candidate_id
                      WHERE o.agency_payment > 0 AND c.created_at BETWEEN ? AND ? GROUP BY c.source`, f, t);
  for (const s of sources) {
    s.spend = (spend.find((x) => x.platform === s.source)?.amount || 0) + (agency.find((x) => x.platform === s.source)?.amount || 0);
    s.conversion = s.outward ? Math.round((s.selected / s.outward) * 1000) / 10 : 0;
    s.cost_per_hire = s.joined ? Math.round(s.spend / s.joined) : null;
  }

  const monthly = await all(`SELECT ${MONTH} AS month, COUNT(*) AS outward,
      SUM(CASE WHEN c.status IN ('Selected','Joined','Not Joined','Left') THEN 1 ELSE 0 END) AS selected,
      SUM(CASE WHEN c.status IN ('Joined','Left') THEN 1 ELSE 0 END) AS joined
    FROM candidates c WHERE c.created_at BETWEEN ? AND ? GROUP BY month ORDER BY month`, f, t);

  const steps = await all(`SELECT s.code, s.no, s.short_name, s.stage, s.doer_role,
      SUM(CASE WHEN si.state='done' THEN 1 ELSE 0 END) AS done,
      SUM(CASE WHEN si.state='done' AND COALESCE(si.delay_hours,0) <= 0 THEN 1 ELSE 0 END) AS on_time,
      SUM(CASE WHEN si.state='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN si.state='pending' AND si.planned_at < ? THEN 1 ELSE 0 END) AS overdue,
      ROUND(AVG(CASE WHEN si.state='done' THEN si.delay_hours END),1) AS avg_delay_h
    FROM steps s LEFT JOIN step_instances si ON si.step_code=s.code AND COALESCE(si.actual_at, si.planned_at) BETWEEN ? AND ?
    WHERE s.active=1 GROUP BY s.code ORDER BY s.no`, nowS, f, t);
  for (const s of steps) s.on_time_pct = s.done ? Math.round((s.on_time / s.done) * 100) : null;

  const retention = await all(`SELECT strftime('%Y-%m', COALESCE(o.joining_date, o.created_at)) AS month,
      COUNT(*) AS selected,
      SUM(CASE WHEN o.status='Not Joined' THEN 1 ELSE 0 END) AS not_joined,
      SUM(CASE WHEN o.status IN ('Joined','Active','Retained 90','Left') THEN 1 ELSE 0 END) AS joined,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.step_code='S23' AND si.result='Working') THEN 1 ELSE 0 END) AS d30,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.step_code='S24' AND si.result='Working') THEN 1 ELSE 0 END) AS d60,
      SUM(CASE WHEN o.status='Retained 90' THEN 1 ELSE 0 END) AS d90,
      SUM(CASE WHEN o.status='Left' THEN 1 ELSE 0 END) AS left_count,
      SUM(CASE WHEN o.status IN ('Pre-Onboarding') THEN 1 ELSE 0 END) AS pending
    FROM onboardings o GROUP BY month ORDER BY month`);

  const workload = await all(`SELECT s.doer_role AS role, COALESCE(u.name, '') AS person,
      SUM(CASE WHEN si.planned_at < ? THEN 1 ELSE 0 END) AS overdue,
      COUNT(*) AS pending
    FROM step_instances si JOIN steps s ON s.code=si.step_code LEFT JOIN users u ON u.id=s.doer_user_id
    WHERE si.state='pending' GROUP BY s.doer_role, u.name ORDER BY overdue DESC`, nowS);

  const requirementsAging = await all(`SELECT code, designation, company, priority, openings, filled, request_date,
      CAST(julianday('now') - julianday(request_date) AS INTEGER) AS age_days,
      (SELECT COUNT(*) FROM candidates c WHERE c.requirement_id=r.id) AS candidates
    FROM requirements r WHERE status='Open' ORDER BY age_days DESC LIMIT 15`);

  return { kpis, funnel, sources, monthly, steps, retention, workload, requirementsAging, spend_total: spend.reduce((a, b) => a + b.amount, 0) + agency.reduce((a, b) => a + b.amount, 0) };
}

r.get('/dashboard', async (req, res) => res.json(await dashboardData(req.query)));

r.get('/reports/rescue', async (req, res) => {
  // Rescue board: every overdue step across the team, grouped by doer, with escalation flag
  const esc = Number(req.query.escalation_hours || 48);
  const tasks = await listTasks({ scope: 'all', when: 'overdue' });
  res.json(tasks.map((t) => ({ ...t, escalate: t.overdue_hours >= esc })));
});

r.get('/reports/portal-summary', async (req, res) => {
  // Week x source matrix (old PORTAL SUMMARY tab)
  res.json(await all(`SELECT strftime('%Y-W%W', c.created_at) AS week, c.source,
      COUNT(*) AS outward,
      SUM(CASE WHEN EXISTS(SELECT 1 FROM step_instances si WHERE si.entity_type='candidate' AND si.entity_id=c.id AND si.step_code='S07' AND si.result='Came') THEN 1 ELSE 0 END) AS interviews,
      SUM(CASE WHEN c.status IN ('Selected','Joined','Not Joined','Left') THEN 1 ELSE 0 END) AS selections
    FROM candidates c GROUP BY week, c.source ORDER BY week DESC, outward DESC LIMIT 400`));
});

r.get('/reports/export/:what', async (req, res) => {
  const what = req.params.what;
  const q = {
    requirements: `SELECT * FROM requirements ORDER BY id`,
    candidates: `SELECT c.code, c.name, c.mobile, c.email, c.source, c.stage, c.status, c.ai_score, c.interview_at, c.joining_date, r.code AS inward, r.designation, r.company, c.created_at FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id ORDER BY c.id`,
    onboardings: `SELECT o.code, c.name, c.mobile, c.source, r.designation, r.company, o.joining_date, o.status, o.agency_payment FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id ORDER BY o.id`,
    steps: `SELECT COALESCE(r.code,c.code,o.code) AS record, s.code AS step, s.short_name, si.planned_at, si.actual_at, si.state, si.result, si.delay_hours, si.remark
            FROM step_instances si JOIN steps s ON s.code=si.step_code
            LEFT JOIN requirements r ON si.entity_type='requirement' AND r.id=si.entity_id
            LEFT JOIN candidates c ON si.entity_type='candidate' AND c.id=si.entity_id
            LEFT JOIN onboardings o ON si.entity_type='onboarding' AND o.id=si.entity_id ORDER BY si.id`,
  }[what];
  if (!q) return res.status(404).json({ error: 'Unknown export' });
  const rows = await all(q);
  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const esc = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${what}-${now().slice(0, 10)}.csv"`);
  res.send('﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'));
});

export default r;
