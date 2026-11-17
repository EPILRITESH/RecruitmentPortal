// Public (no login) pages: candidate application form, careers page, joinee feedback.
// These replace the Google Forms that candidates used to fill.
import { Router } from 'express';
import { all, get, run, logActivity, setting } from '../db.js';
import { completeStep, httpError } from '../workflow.js';
import { createCandidate } from '../candidates.js';
import { upload } from './recruit.js';
import { saveUpload } from '../storage.js';

const r = Router();

r.get('/info', async (req, res) => res.json({ company: await setting('company_name', 'EPIL Group'), address: await setting('office_address', '') }));

// ---- personal application link sent on WhatsApp (Step 6) ----
r.get('/apply/:token', async (req, res) => {
  const c = await get(`SELECT c.name, c.mobile, c.email, c.current_company, c.experience_years, c.current_ctc, c.expected_ctc, c.notice_period, c.location, c.qualification, c.skills,
                 c.resume_path IS NOT NULL AS has_resume, r.designation, r.company, r.salary_range
                 FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.apply_token=?`, req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  res.json(c);
});

r.post('/apply/:token', upload.single('resume'), async (req, res) => {
  const c = await get('SELECT * FROM candidates WHERE apply_token=?', req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  const b = req.body || {};
  const cols = ['email', 'current_company', 'experience_years', 'current_ctc', 'expected_ctc', 'notice_period', 'location', 'qualification', 'skills'];
  await run(`UPDATE candidates SET ${cols.map((k) => `${k}=COALESCE(NULLIF(?,''),${k})`).join(',')} WHERE id=?`, ...cols.map((k) => b[k] ?? ''), c.id);
  if (req.file) await run('UPDATE candidates SET resume_path=? WHERE id=?', await saveUpload(req.file), c.id);
  await logActivity('candidate', c.id, 'Candidate filled application form', req.file ? 'Resume attached' : null, null);
  // auto-complete Step 6 if it is waiting (the "reminder machine" stamps itself)
  const s6 = await get(`SELECT id FROM step_instances WHERE entity_type='candidate' AND entity_id=? AND step_code='S06' AND state='pending'`, c.id);
  if (s6) await completeStep(s6.id, { result: 'Form Filled', remark: 'Filled by candidate via link' }, null);
  res.json({ ok: true });
});

// ---- careers page / platform apply links (?job=IN-170&src=WORK INDIA) ----
r.get('/jobs', async (req, res) => res.json(await all(`SELECT id, code, designation, company, salary_range, location, experience, qualification, openings - filled AS openings,
                                           jd_status, request_date FROM requirements WHERE status='Open' ORDER BY id DESC`)));
r.get('/jobs/:code', async (req, res) => {
  const j = await get(`SELECT id, code, designation, company, salary_range, location, experience, qualification, skills, openings - filled AS openings, jd_text, status, request_date
                       FROM requirements WHERE code=? OR id=?`, req.params.code, Number(req.params.code) || -1);
  if (!j || j.status !== 'Open') throw httpError(404, 'This job is closed');
  res.json(j);
});

async function sourceFrom(src) {
  const name = String(src || '').trim().toUpperCase();
  if (name && (await get('SELECT name FROM platforms WHERE name=?', name))) return name;
  return 'CAREERS PAGE / WALK-IN';
}

r.post('/jobs/:id/apply', upload.single('resume'), async (req, res) => {
  const job = await get(`SELECT id FROM requirements WHERE (id=? OR code=?) AND status='Open'`, Number(req.params.id) || -1, req.params.id);
  if (!job) throw httpError(404, 'This job is closed');
  const b = req.body || {};
  const resume_path = await saveUpload(req.file);
  const out = await createCandidate({ ...b, requirement_id: job.id, source: await sourceFrom(b.source) }, { channel: 'careers', resume_path });
  res.json({ ok: true, duplicate: !!out.duplicate });
});

// ---- webhook for job platforms / Zapier / Make / partner APIs ----
// POST /api/public/inbound/<token>   JSON or multipart:
// { name, mobile, email, platform, job_code, resume_url, experience_years, current_ctc, expected_ctc, location, qualification, skills }
r.post('/inbound/:token', upload.single('resume'), async (req, res) => {
  const token = await setting('inbound_token');
  if (!token || req.params.token !== token) throw httpError(401, 'Invalid token');
  const b = req.body || {};
  const code = b.job_code || b.requirement_code || b.job || null;
  const job = code ? await get(`SELECT id FROM requirements WHERE code=? OR id=?`, code, Number(code) || -1) : null;
  const resume_path = await saveUpload(req.file);
  const out = await createCandidate({ ...b, requirement_id: job?.id || null, source: await sourceFrom(b.platform || b.source) }, { channel: 'webhook', resume_path });
  res.json({ ok: true, ...out });
});

// ---- joinee feedback (Step 20) ----
r.get('/feedback/:token', async (req, res) => {
  const c = await get(`SELECT c.name, r.designation, r.company FROM candidates c LEFT JOIN requirements r ON r.id=c.requirement_id WHERE c.apply_token=?`, req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  res.json(c);
});
r.post('/feedback/:token', async (req, res) => {
  const c = await get('SELECT id FROM candidates WHERE apply_token=?', req.params.token);
  if (!c) throw httpError(404, 'This link is not valid');
  const o = await get('SELECT id FROM onboardings WHERE candidate_id=?', c.id);
  if (!o) throw httpError(400, 'Onboarding not started yet');
  const inst = await get(`SELECT id FROM step_instances WHERE entity_type='onboarding' AND entity_id=? AND step_code='S20' AND state='pending'`, o.id);
  const b = req.body || {};
  const remark = `Rating ${b.rating}/5. ${b.comments || ''}`.trim();
  if (inst) await completeStep(inst.id, { result: 'Filled', remark, data: b }, null);
  await logActivity('onboarding', o.id, 'Joinee feedback received', remark, null);
  res.json({ ok: true });
});

export default r;
