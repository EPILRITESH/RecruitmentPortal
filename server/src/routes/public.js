// Public (no login) pages: candidate application form, careers page, joinee feedback.
// These replace the Google Forms that candidates used to fill.
import { Router } from 'express';
import crypto from 'node:crypto';
import { all, get, run, now, nextCode, logActivity, setting } from '../db.js';
import { completeStep, startWorkflow, httpError } from '../workflow.js';
import { upload } from './recruit.js';

const r = Router();

r.get('/info', (req, res) => res.json({ company: setting('company_name', 'EPIL Group'), address: setting('office_address', '') }));

// ---- personal application link sent on WhatsApp (Step 6) ----
r.get('/apply/:token', (req, res) => {
  const c = get(`SELECT c.name, c.mobile, c.email, c.current_company, c.experience_years, c.current_ctc, c.expected_ctc, c.notice_period, c.location, c.qualification, c.skills,
                 c.resume_path IS NOT NULL AS has_resume, r.designation, r.company, r.salary_range
                 FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.apply_token=?`, req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  res.json(c);
});

r.post('/apply/:token', upload.single('resume'), (req, res) => {
  const c = get('SELECT * FROM candidates WHERE apply_token=?', req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  const b = req.body || {};
  const cols = ['email', 'current_company', 'experience_years', 'current_ctc', 'expected_ctc', 'notice_period', 'location', 'qualification', 'skills'];
  run(`UPDATE candidates SET ${cols.map((k) => `${k}=COALESCE(NULLIF(?,''),${k})`).join(',')} WHERE id=?`, ...cols.map((k) => b[k] ?? ''), c.id);
  if (req.file) run('UPDATE candidates SET resume_path=? WHERE id=?', req.file.filename, c.id);
  logActivity('candidate', c.id, 'Candidate filled application form', req.file ? 'Resume attached' : null, null);
  // auto-complete Step 6 if it is waiting (the "reminder machine" stamps itself)
  const s6 = get(`SELECT id FROM step_instances WHERE entity_type='candidate' AND entity_id=? AND step_code='S06' AND state='pending'`, c.id);
  if (s6) completeStep(s6.id, { result: 'Form Filled', remark: 'Filled by candidate via link' }, null);
  res.json({ ok: true });
});

// ---- careers page / walk-in QR ----
r.get('/jobs', (req, res) => res.json(all(`SELECT id, code, designation, company, salary_range, location, experience, qualification, openings - filled AS openings
                                           FROM requirements WHERE status='Open' ORDER BY id DESC`)));

r.post('/jobs/:id/apply', upload.single('resume'), (req, res) => {
  const job = get(`SELECT id FROM requirements WHERE id=? AND status='Open'`, req.params.id);
  if (!job) throw httpError(404, 'This job is closed');
  const b = req.body || {};
  const mobile = String(b.mobile || '').replace(/\D/g, '').slice(-10);
  if (!b.name || mobile.length !== 10) throw httpError(400, 'Name and a 10-digit mobile number are required');
  const dup = get('SELECT id FROM candidates WHERE mobile=? AND requirement_id=?', mobile, job.id);
  if (dup) return res.json({ ok: true, duplicate: true });
  const code = nextCode('candidates', 'OUT', 2891);
  const x = run(`INSERT INTO candidates(code, requirement_id, name, mobile, email, source, experience_years, current_ctc, expected_ctc, notice_period, location, qualification, skills, resume_path, apply_token, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, job.id, b.name.trim(), mobile, b.email, b.source || 'CAREERS PAGE / WALK-IN', b.experience_years || null, b.current_ctc, b.expected_ctc, b.notice_period, b.location,
    b.qualification, b.skills, req.file ? req.file.filename : null, crypto.randomBytes(9).toString('base64url'), now());
  const id = Number(x.lastInsertRowid);
  startWorkflow('candidate', id);
  logActivity('candidate', id, 'Applied via careers page', null, null);
  res.json({ ok: true });
});

// ---- joinee feedback (Step 20) ----
r.get('/feedback/:token', (req, res) => {
  const c = get(`SELECT c.name, r.designation, r.company FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.apply_token=?`, req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  res.json(c);
});
r.post('/feedback/:token', (req, res) => {
  const c = get('SELECT id FROM candidates WHERE apply_token=?', req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  const o = get('SELECT id FROM onboardings WHERE candidate_id=?', c.id);
  if (!o) throw httpError(400, 'Onboarding not started yet');
  const inst = get(`SELECT id FROM step_instances WHERE entity_type='onboarding' AND entity_id=? AND step_code='S20' AND state='pending'`, o.id);
  const b = req.body || {};
  const remark = `Rating ${b.rating}/5. ${b.comments || ''}`.trim();
  if (inst) completeStep(inst.id, { result: 'Filled', remark, data: b }, null);
  logActivity('onboarding', o.id, 'Joinee feedback received', remark, null);
  res.json({ ok: true });
});

export default r;
