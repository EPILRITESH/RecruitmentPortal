// Inward (requirements), Outward (candidates), Onboarding, Tasks, Communication, AI
import { Router } from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import { all, get, run, now, nextCode, logActivity } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { startWorkflow, completeStep, listTasks, tracker, replanOnboarding, httpError } from '../workflow.js';
import { generateJD, parseCV, screenCandidate, draftMessage, askAssistant } from '../ai.js';
import { fillTemplate, candidateVars, sendWhatsApp, sendEmail } from '../notify.js';
import { saveUpload } from '../storage.js';
import { dashboardData } from './reports.js';

// Files are kept in memory, then saved to R2 (Cloudflare) or ./uploads (Node) by saveUpload()
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const memUpload = upload;

const r = Router();
r.use(requireAuth);
const normMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

// ======================= TASKS (to-do machine) =======================
r.get('/tasks', async (req, res) => {
  const { scope = 'mine', when = 'due', stage, q } = req.query;
  res.json(await listTasks({ user: req.user, scope, when, stage, q }));
});
r.get('/tasks/summary', async (req, res) => {
  const mine = await listTasks({ user: req.user, scope: 'mine', when: 'all' });
  const nowS = now();
  const endToday = nowS.slice(0, 10) + ' 23:59:59';
  res.json({
    overdue: mine.filter((t) => t.planned_at < nowS).length,
    today: mine.filter((t) => t.planned_at >= nowS && t.planned_at <= endToday).length,
    upcoming: mine.filter((t) => t.planned_at > endToday).length,
  });
});
r.post('/tasks/:id/complete', async (req, res) => {
  const inst = await completeStep(Number(req.params.id), req.body || {}, req.user);
  res.json(inst);
});
r.post('/tasks/:id/follow-up', async (req, res) => {
  await run('UPDATE step_instances SET follow_ups=follow_ups+1, last_follow_up=?, remark=COALESCE(?,remark) WHERE id=?', now(), req.body?.remark, req.params.id);
  res.json({ ok: true });
});

// ======================= INWARD: requirements =======================
r.get('/requirements', async (req, res) => {
  const { status, company, q } = req.query;
  const where = ['1=1']; const p = [];
  if (status) { where.push('r.status=?'); p.push(status); }
  if (company) { where.push('r.company=?'); p.push(company); }
  if (q) { where.push('(r.designation LIKE ? OR r.code LIKE ? OR r.requirement_by LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(await all(`SELECT r.*,
      (SELECT COUNT(*) FROM candidates c WHERE c.requirement_id=r.id) AS total_candidates,
      (SELECT COUNT(*) FROM candidates c WHERE c.requirement_id=r.id AND c.status='Active') AS active_candidates,
      (SELECT COUNT(*) FROM candidates c WHERE c.requirement_id=r.id AND c.status IN ('Selected','Joined')) AS selected,
      (SELECT s.short_name FROM step_instances si JOIN steps s ON s.code=si.step_code WHERE si.entity_type='requirement' AND si.entity_id=r.id AND si.state='pending' ORDER BY s.no LIMIT 1) AS pending_step,
      CAST(julianday('now') - julianday(r.request_date) AS INTEGER) AS age_days
    FROM requirements r WHERE ${where.join(' AND ')} ORDER BY r.id DESC`, ...p));
});

r.post('/requirements', async (req, res) => {
  const b = req.body || {};
  if (!b.company || !b.designation || !b.requirement_by) throw httpError(400, 'Company, designation and requirement by are required');
  const code = await nextCode('requirements', 'IN', 166);
  const x = await run(`INSERT INTO requirements(code, request_date, company, designation, department, salary_range, openings, requirement_by, priority, target_date,
                 experience, qualification, skills, location, notes, created_by, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, b.request_date || now().slice(0, 10), b.company, b.designation.trim(), b.department, b.salary_range, Number(b.openings) || 1, b.requirement_by,
    b.priority || 'Normal', b.target_date, b.experience, b.qualification, b.skills, b.location, b.notes, req.user.id, now());
  const id = Number(x.lastInsertRowid);
  await run(`INSERT INTO masters(type,name) VALUES('designation',?) ON CONFLICT DO NOTHING`, b.designation.trim().toUpperCase());
  await startWorkflow('requirement', id);
  await logActivity('requirement', id, 'Requirement raised', `${b.designation} for ${b.company} by ${b.requirement_by}`, req.user.id);
  res.json({ id, code });
});

r.get('/requirements/:id', async (req, res) => {
  const reqm = await get('SELECT * FROM requirements WHERE id=?', req.params.id);
  if (!reqm) throw httpError(404, 'Requirement not found');
  res.json({
    requirement: reqm,
    steps: await tracker('requirement', reqm.id),
    candidates: await all('SELECT id, code, name, mobile, source, stage, status, ai_score, interview_at, created_at FROM candidates WHERE requirement_id=? ORDER BY id DESC', reqm.id),
    activity: await all(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type='requirement' AND entity_id=? ORDER BY a.id DESC LIMIT 50`, reqm.id),
    payments: await all('SELECT * FROM portal_payments WHERE requirement_id=?', reqm.id),
  });
});

r.put('/requirements/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['company', 'designation', 'department', 'salary_range', 'openings', 'requirement_by', 'priority', 'target_date', 'experience', 'qualification', 'skills', 'location', 'notes', 'jd_text', 'jd_status', 'status'];
  const sets = cols.filter((c) => c in b);
  if (sets.length) await run(`UPDATE requirements SET ${sets.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...sets.map((c) => b[c]), req.params.id);
  if (b.status === 'Closed' || b.status === 'Cancelled') {
    await run('UPDATE requirements SET closed_at=? WHERE id=?', now(), req.params.id);
    await run(`UPDATE step_instances SET state='cancelled' WHERE entity_type='requirement' AND entity_id=? AND state='pending'`, req.params.id);
  }
  if (b.jd_status) await logActivity('requirement', Number(req.params.id), `JD ${b.jd_status}`, null, req.user.id);
  if (b.status) await logActivity('requirement', Number(req.params.id), `Status → ${b.status}`, b.remark, req.user.id);
  res.json({ ok: true });
});

r.post('/requirements/:id/generate-jd', async (req, res) => {
  const reqm = await get('SELECT * FROM requirements WHERE id=?', req.params.id);
  if (!reqm) throw httpError(404, 'Requirement not found');
  const jd = await generateJD(reqm, req.user);
  res.json(jd);
});

// ======================= OUTWARD: candidates =======================
r.get('/candidates', async (req, res) => {
  const { status, stage, source, requirement_id, q, limit = 500 } = req.query;
  const where = ['1=1']; const p = [];
  if (status) { where.push('c.status=?'); p.push(status); }
  if (stage) { where.push('c.stage=?'); p.push(stage); }
  if (source) { where.push('c.source=?'); p.push(source); }
  if (requirement_id) { where.push('c.requirement_id=?'); p.push(requirement_id); }
  if (q) { where.push('(c.name LIKE ? OR c.mobile LIKE ? OR c.code LIKE ?)'); p.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  res.json(await all(`SELECT c.id, c.code, c.name, c.mobile, c.email, c.source, c.stage, c.status, c.ai_score, c.interview_at, c.joining_date, c.created_at, c.experience_years,
      c.requirement_id, r.code AS req_code, r.designation, r.company,
      (SELECT si.planned_at FROM step_instances si WHERE si.entity_type='candidate' AND si.entity_id=c.id AND si.state='pending' LIMIT 1) AS next_due,
      (SELECT si.step_code FROM step_instances si WHERE si.entity_type='candidate' AND si.entity_id=c.id AND si.state='pending' LIMIT 1) AS current_step
    FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE ${where.join(' AND ')} ORDER BY c.id DESC LIMIT ?`, ...p, Number(limit)));
});

r.get('/candidates/check-duplicate', async (req, res) => {
  const m = normMobile(req.query.mobile);
  if (m.length < 10) return res.json([]);
  res.json(await all(`SELECT c.id, c.code, c.name, c.status, c.stage, c.created_at, r.designation, r.company FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id
                WHERE substr(replace(replace(c.mobile,' ',''),'-',''), -10) = ? ORDER BY c.id DESC`, m));
});

r.post('/candidates/parse-cv', memUpload.single('resume'), async (req, res) => {
  if (!req.file && !req.body.text) throw httpError(400, 'Upload a resume or paste text');
  const out = await parseCV({ buffer: req.file?.buffer, mimetype: req.file?.mimetype, text: req.body.text }, req.user);
  res.json(out);
});

r.post('/candidates', upload.single('resume'), async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.mobile || !b.source) throw httpError(400, 'Name, mobile and source are required');
  const mobile = normMobile(b.mobile);
  const dups = await all(`SELECT code, status FROM candidates WHERE substr(replace(replace(mobile,' ',''),'-',''), -10)=? AND requirement_id IS ?`, mobile, b.requirement_id || null);
  if (dups.length && b.force !== '1' && b.force !== true) throw httpError(409, `Duplicate: this mobile is already added for this requirement (${dups.map((d) => d.code).join(', ')})`);
  const src = await get(`SELECT email FROM masters WHERE type='source' AND name=?`, b.source);
  const code = await nextCode('candidates', 'OUT', 2891);
  const x = await run(`INSERT INTO candidates(code, requirement_id, name, mobile, email, source, consultancy_email, current_company, experience_years, current_ctc, expected_ctc,
                 notice_period, location, qualification, skills, resume_path, resume_url, resume_text, apply_token, created_by, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, b.requirement_id || null, b.name.trim(), mobile, b.email, b.source, b.consultancy_email || src?.email || null, b.current_company, b.experience_years ? Number(b.experience_years) : null,
    b.current_ctc, b.expected_ctc, b.notice_period, b.location, b.qualification, b.skills, await saveUpload(req.file), b.resume_url, b.resume_text,
    crypto.randomBytes(9).toString('base64url'), req.user.id, now());
  const id = Number(x.lastInsertRowid);
  await startWorkflow('candidate', id);
  await logActivity('candidate', id, 'Candidate added', `Source: ${b.source}`, req.user.id);
  res.json({ id, code });
});

r.get('/candidates/:id', async (req, res) => {
  const c = await get(`SELECT c.*, r.code AS req_code, r.designation, r.company, r.salary_range FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.id=?`, req.params.id);
  if (!c) throw httpError(404, 'Candidate not found');
  c.ai_questions = c.ai_questions ? JSON.parse(c.ai_questions) : null;
  c.ai_summary = c.ai_summary ? JSON.parse(c.ai_summary) : null;
  const onb = await get('SELECT id, code, status FROM onboardings WHERE candidate_id=?', c.id);
  res.json({
    candidate: c,
    onboarding: onb || null,
    steps: await tracker('candidate', c.id),
    messages: await all('SELECT m.*, u.name AS user_name FROM messages m LEFT JOIN users u ON u.id=m.user_id WHERE candidate_id=? ORDER BY m.id DESC', c.id),
    activity: await all(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type='candidate' AND entity_id=? ORDER BY a.id DESC LIMIT 50`, c.id),
    duplicates: await all(`SELECT c2.id, c2.code, c2.status, r.designation FROM candidates c2 LEFT JOIN requirements r ON r.id=c2.requirement_id WHERE substr(c2.mobile,-10)=substr(?, -10) AND c2.id<>?`, c.mobile, c.id),
  });
});

r.put('/candidates/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['name', 'mobile', 'email', 'source', 'consultancy_email', 'current_company', 'experience_years', 'current_ctc', 'expected_ctc', 'notice_period', 'location',
    'qualification', 'skills', 'requirement_id', 'interview_at', 'interviewer', 'joining_date', 'offered_salary', 'resume_url', 'resume_text'];
  const sets = cols.filter((c) => c in b);
  if (sets.length) await run(`UPDATE candidates SET ${sets.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...sets.map((c) => (b[c] === '' ? null : b[c])), req.params.id);
  if (b.interview_at) {
    await run(`UPDATE step_instances SET planned_at=? WHERE entity_type='candidate' AND entity_id=? AND step_code='S07' AND state='pending'`, b.interview_at.replace('T', ' '), req.params.id);
  }
  res.json({ ok: true });
});

r.post('/candidates/:id/resume', upload.single('resume'), async (req, res) => {
  if (!req.file) throw httpError(400, 'No file');
  const file = await saveUpload(req.file);
  await run('UPDATE candidates SET resume_path=? WHERE id=?', file, req.params.id);
  res.json({ ok: true, file });
});

r.post('/candidates/:id/reopen', requireRole('recruiter', 'approver'), async (req, res) => {
  // bring a rejected / future-hold candidate back into the pipeline at screening
  await run(`UPDATE candidates SET status='Active', stage='Screening' WHERE id=?`, req.params.id);
  await run(`DELETE FROM step_instances WHERE entity_type='candidate' AND entity_id=? AND state IN ('cancelled')`, req.params.id);
  const last = await get(`SELECT si.step_code FROM step_instances si JOIN steps s ON s.code=si.step_code WHERE entity_type='candidate' AND entity_id=? ORDER BY s.no DESC LIMIT 1`, req.params.id);
  await run(`UPDATE step_instances SET state='pending', actual_at=NULL, result=NULL WHERE entity_type='candidate' AND entity_id=? AND step_code=?`, req.params.id, last?.step_code || 'S04');
  await logActivity('candidate', Number(req.params.id), 'Re-opened', req.body?.remark, req.user.id);
  res.json({ ok: true });
});

r.post('/candidates/:id/screen', async (req, res) => {
  const c = await get('SELECT * FROM candidates WHERE id=?', req.params.id);
  if (!c) throw httpError(404, 'Candidate not found');
  const reqm = c.requirement_id ? await get('SELECT * FROM requirements WHERE id=?', c.requirement_id) : null;
  const out = await screenCandidate(c, reqm, req.user);
  await run('UPDATE candidates SET ai_score=?, ai_summary=?, ai_questions=? WHERE id=?', Math.round(out.score),
    JSON.stringify({ verdict: out.verdict, strengths: out.strengths, gaps: out.gaps, summary: out.summary, mode: out._mode }), JSON.stringify(out.questions), c.id);
  await logActivity('candidate', c.id, `AI screening: ${Math.round(out.score)}/100 (${out.verdict})`, null, req.user.id);
  res.json(out);
});

// ---- communication ----
r.post('/candidates/:id/message', async (req, res) => {
  const c = await get('SELECT * FROM candidates WHERE id=?', req.params.id);
  if (!c) throw httpError(404, 'Candidate not found');
  const { channel = 'whatsapp', template, body, subject, to } = req.body || {};
  const vars = await candidateVars(c.id, { recruiter: req.user.name });
  let text = body, subj = subject;
  if (!text && template) {
    const t = await get('SELECT * FROM templates WHERE key=?', template);
    text = fillTemplate(t?.body, vars);
    subj = fillTemplate(t?.subject, vars);
  }
  if (!text) throw httpError(400, 'Message is empty');
  const out = channel === 'email'
    ? await sendEmail({ to: to || c.email, subject: subj, body: text, candidate_id: c.id, template, user: req.user })
    : await sendWhatsApp({ to: to || c.mobile, body: text, candidate_id: c.id, template, user: req.user });
  await logActivity('candidate', c.id, `${channel === 'email' ? 'Email' : 'WhatsApp'} ${out.status}`, template || subj, req.user.id);
  res.json(out);
});

r.get('/candidates/:id/preview-template', async (req, res) => {
  const t = await get('SELECT * FROM templates WHERE key=?', req.query.template);
  const vars = await candidateVars(Number(req.params.id), { recruiter: req.user.name });
  res.json({ subject: fillTemplate(t?.subject, vars), body: fillTemplate(t?.body, vars), channel: t?.channel });
});

r.post('/candidates/:id/email-consultancy', async (req, res) => {
  const c = await get('SELECT * FROM candidates WHERE id=?', req.params.id);
  const to = c.consultancy_email;
  if (!to) throw httpError(400, 'No consultancy email for this candidate');
  const t = await get(`SELECT * FROM templates WHERE key='consultancy_selection'`);
  const vars = await candidateVars(c.id);
  const out = await sendEmail({ to, subject: fillTemplate(t.subject, vars), body: fillTemplate(t.body, vars), candidate_id: c.id, template: 'consultancy_selection', user: req.user });
  await logActivity('candidate', c.id, `Consultancy email ${out.status}`, to, req.user.id);
  res.json(out);
});

r.post('/ai/draft-message', async (req, res) => {
  const c = req.body.candidate_id ? await get('SELECT * FROM candidates WHERE id=?', req.body.candidate_id) : null;
  const reqm = c?.requirement_id ? await get('SELECT * FROM requirements WHERE id=?', c.requirement_id) : null;
  res.json(await draftMessage({ ...req.body, candidate: c, requirement: reqm }, req.user));
});

r.post('/ai/ask', async (req, res) => {
  const q = String(req.body?.question || '').trim();
  if (!q) throw httpError(400, 'Ask a question');
  const snapshot = await dashboardData({});
  snapshot.overdue = (await listTasks({ scope: 'all', when: 'overdue' })).slice(0, 60).map((t) => ({ step: t.short_name, record: t.record_code, title: t.title, planned: t.planned_at, overdue_hours: t.overdue_hours, doer: t.doer_role }));
  snapshot.open_requirements = await all(`SELECT code, designation, company, openings, filled, priority, request_date, requirement_by FROM requirements WHERE status='Open' ORDER BY id DESC LIMIT 60`);
  snapshot.today = now();
  res.json(await askAssistant(q, snapshot, req.user));
});

r.get('/ai/runs', async (req, res) => res.json(await all('SELECT a.id, a.agent, a.entity_type, a.entity_id, a.mode, a.created_at, u.name AS user_name FROM ai_runs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 100')));

// ======================= ONBOARDING =======================
r.get('/onboardings', async (req, res) => {
  const { status, q } = req.query;
  const where = ['1=1']; const p = [];
  if (status) { where.push('o.status=?'); p.push(status); }
  if (q) { where.push('(c.name LIKE ? OR o.code LIKE ?)'); p.push(`%${q}%`, `%${q}%`); }
  res.json(await all(`SELECT o.*, c.name, c.mobile, c.source, c.code AS cand_code, r.designation, r.company,
      (SELECT COUNT(*) FROM step_instances si WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.state='done') AS done_steps,
      (SELECT COUNT(*) FROM step_instances si WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.state<>'cancelled') AS total_steps,
      (SELECT s.short_name FROM step_instances si JOIN steps s ON s.code=si.step_code WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.state='pending' ORDER BY si.planned_at LIMIT 1) AS next_step,
      (SELECT si.planned_at FROM step_instances si WHERE si.entity_type='onboarding' AND si.entity_id=o.id AND si.state='pending' ORDER BY si.planned_at LIMIT 1) AS next_due
    FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id
    WHERE ${where.join(' AND ')} ORDER BY o.id DESC`, ...p));
});

export const ONBOARDING_CHECKLIST = ['Dedicated desk / space ready', 'Intro to company (corporate video)', 'Intro to buddy + HOD', 'Doer worklist + buddy worklist shared',
  'Training plan shared', 'See work for 6 days', 'Leave policy explained', 'Joining form signed', 'Aadhaar / PAN / photos collected', 'Bank details collected',
  'ID card issued', 'Official email / SIM / phone issued', 'Added to attendance system', 'Added to WhatsApp work groups'];

r.get('/onboardings/:id', async (req, res) => {
  const o = await get(`SELECT o.*, c.name, c.mobile, c.email, c.source, c.id AS candidate_id, c.code AS cand_code, c.offered_salary, r.designation, r.company
                 FROM onboardings o JOIN candidates c ON c.id=o.candidate_id LEFT JOIN requirements r ON r.id=c.requirement_id WHERE o.id=?`, req.params.id);
  if (!o) throw httpError(404, 'Onboarding not found');
  o.checklist = JSON.parse(o.checklist || '{}');
  res.json({
    onboarding: o,
    checklist_items: ONBOARDING_CHECKLIST,
    steps: await tracker('onboarding', o.id),
    activity: await all(`SELECT a.*, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id=a.user_id WHERE entity_type='onboarding' AND entity_id=? ORDER BY a.id DESC LIMIT 50`, o.id),
  });
});

r.put('/onboardings/:id', async (req, res) => {
  const b = req.body || {};
  const cols = ['joining_date', 'department', 'buddy', 'agency_payment'];
  const sets = cols.filter((c) => c in b);
  if (sets.length) await run(`UPDATE onboardings SET ${sets.map((c) => `${c}=?`).join(',')} WHERE id=?`, ...sets.map((c) => b[c]), req.params.id);
  if (b.checklist) await run('UPDATE onboardings SET checklist=? WHERE id=?', JSON.stringify(b.checklist), req.params.id);
  if ('joining_date' in b) {
    await replanOnboarding(Number(req.params.id));
    const o = await get('SELECT candidate_id FROM onboardings WHERE id=?', req.params.id);
    await run('UPDATE candidates SET joining_date=? WHERE id=?', b.joining_date, o.candidate_id);
    await logActivity('onboarding', Number(req.params.id), 'Joining date changed', b.joining_date, req.user.id);
  }
  res.json({ ok: true });
});

// ======================= PAYMENTS =======================
r.get('/portal-payments', async (req, res) => res.json(await all('SELECT * FROM portal_payments ORDER BY COALESCE(posted_date, created_at) DESC')));
r.post('/portal-payments', requireRole('recruiter', 'accounts', 'hr'), upload.single('invoice'), async (req, res) => {
  const b = req.body || {};
  await run('INSERT INTO portal_payments(platform, post_name, posted_date, closed_date, amount, invoice, requirement_id, created_at) VALUES(?,?,?,?,?,?,?,?)',
    b.platform, b.post_name, b.posted_date, b.closed_date, Number(b.amount) || 0, req.file ? await saveUpload(req.file) : b.invoice, b.requirement_id || null, now());
  res.json({ ok: true });
});
r.delete('/portal-payments/:id', requireRole('accounts'), async (req, res) => { await run('DELETE FROM portal_payments WHERE id=?', req.params.id); res.json({ ok: true }); });

// ======================= ACTIVITY FEED =======================
r.get('/activity', async (req, res) => res.json(await all(`SELECT a.*, u.name AS user_name,
   CASE a.entity_type WHEN 'requirement' THEN (SELECT code FROM requirements WHERE id=a.entity_id)
     WHEN 'candidate' THEN (SELECT code || ' ' || name FROM candidates WHERE id=a.entity_id)
     ELSE (SELECT o.code || ' ' || c.name FROM onboardings o JOIN candidates c ON c.id=o.candidate_id WHERE o.id=a.entity_id) END AS record
   FROM activity a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 40`)));

export default r;

