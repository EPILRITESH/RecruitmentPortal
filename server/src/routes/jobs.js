// Job posting to platforms, Outbox (WhatsApp / email queue), automation rules, bulk candidate actions
import { Router } from 'express';
import { all, get, run, now, setting, logActivity } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { autoCompleteStep, completeStep, httpError } from '../workflow.js';
import { sendEmail, fillTemplate, retryMessage, emailConfigured, whatsappConfigured } from '../notify.js';
import { EVENTS, RECIPIENTS, afterManualSend } from '../automation.js';
import { createCandidate, autoScreen } from '../candidates.js';

const r = Router();
r.use(requireAuth);

export const DEFAULT_PLATFORMS = [
  // name, method, post_url, email, sort
  ['CAREERS PAGE / WALK-IN', 'careers', null, null, 1],
  ['WORK INDIA', 'assisted', 'https://employer.workindia.in/', null, 10],
  ['APNA JOB', 'assisted', 'https://employer.apna.co/', null, 11],
  ['LINKEDIN', 'assisted', 'https://www.linkedin.com/talent/post-a-job', null, 12],
  ['NAUKRI', 'assisted', 'https://recruit.naukri.com/', null, 13],
  ['INDEED', 'assisted', 'https://employers.indeed.com/', null, 14],
  ['STAFF REFERENCE', 'whatsapp', null, null, 20],
  ['NILESH BAROT', 'email', null, 'Consultant_nilesh@yahoo.com', 30],
  ['U N PLACEMENT', 'email', null, 'un.jobplacement@gmail.com', 31],
  ['RISHI JOBS', 'email', null, 'client@rishijobs.in', 32],
  ['PLEASANT INC', 'email', null, 'hr@pleasantinc.com', 33],
  ['KAMKAJ RECRUITMENT', 'email', null, 'Kamkajplacement@gmail.com', 34],
];
export async function seedPlatforms() {
  for (const [name, method, post_url, email, sort] of DEFAULT_PLATFORMS) {
    await run('INSERT INTO platforms(name, method, post_url, email, sort) VALUES(?,?,?,?,?) ON CONFLICT(name) DO NOTHING', name, method, post_url, email, sort);
    await run(`INSERT INTO masters(type,name,email) VALUES('source',?,?) ON CONFLICT(type,name) DO NOTHING`, name, email);
  }
}

export async function applyLink(reqm, platform) {
  const base = await setting('public_url', '');
  return `${base}/careers?job=${encodeURIComponent(reqm.code)}&src=${encodeURIComponent(platform)}`;
}

function postText(reqm, link) {
  const jd = (reqm.jd_text || '').trim();
  return `📢 We are hiring: ${reqm.designation}\n🏢 ${reqm.company}${reqm.location ? ` · 📍 ${reqm.location}` : ''}\n💰 Salary: ${reqm.salary_range || 'As per experience'}\n👥 Openings: ${reqm.openings}\n${reqm.experience ? `🎯 Experience: ${reqm.experience}\n` : ''}\n${jd.slice(0, 1800)}\n\n✅ Apply here: ${link}`;
}

// ------------------------------------------------------------------ platforms
r.get('/platforms', async (req, res) => res.json(await all('SELECT * FROM platforms ORDER BY sort, name')));
r.put('/platforms/:name', requireRole('recruiter'), async (req, res) => {
  const b = req.body || {};
  await run(`INSERT INTO platforms(name, method, post_url, email, api_url, api_key, cost_note, active, sort) VALUES(?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET method=excluded.method, post_url=excluded.post_url, email=excluded.email, api_url=excluded.api_url,
    api_key=CASE WHEN excluded.api_key='••••' THEN platforms.api_key ELSE excluded.api_key END, cost_note=excluded.cost_note, active=excluded.active, sort=excluded.sort`,
  req.params.name.toUpperCase(), b.method || 'assisted', b.post_url || null, b.email || null, b.api_url || null, b.api_key || null, b.cost_note || null, b.active ?? 1, b.sort ?? 50);
  await run(`INSERT INTO masters(type,name,email) VALUES('source',?,?) ON CONFLICT(type,name) DO UPDATE SET email=excluded.email, active=1`, req.params.name.toUpperCase(), b.email || null);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ job posting
r.get('/requirements/:id/posts', async (req, res) => {
  const reqm = await get('SELECT * FROM requirements WHERE id=?', req.params.id);
  if (!reqm) throw httpError(404, 'Requirement not found');
  const posts = await all('SELECT p.*, u.name AS posted_by_name FROM job_posts p LEFT JOIN users u ON u.id=p.posted_by WHERE requirement_id=? ORDER BY p.id', reqm.id);
  const platforms = await all('SELECT name, method, post_url, email, api_url IS NOT NULL AND api_url<>\'\' AS has_api FROM platforms WHERE active=1 ORDER BY sort, name');
  for (const p of platforms) p.apply_link = await applyLink(reqm, p.name);
  const counts = await all('SELECT source, COUNT(*) n FROM candidates WHERE requirement_id=? GROUP BY source', reqm.id);
  res.json({ posts, platforms, counts, text: postText(reqm, await applyLink(reqm, 'CAREERS PAGE / WALK-IN')) });
});

async function markPosted(post, user, url) {
  await run(`UPDATE job_posts SET status='Posted', posted_at=?, posted_by=?, post_url=COALESCE(?, post_url), error=NULL WHERE id=?`, now(), user?.id ?? null, url || null, post.id);
  await logActivity('requirement', post.requirement_id, `Job posted on ${post.platform}`, url || null, user?.id);
  // the portal knows the job is out: close Step 1 (JD) and Step 2 (enquiry posted) with actual time
  await autoCompleteStep('requirement', post.requirement_id, 'S01', 'Done', 'Auto: JD approved & job posted', user);
  await autoCompleteStep('requirement', post.requirement_id, 'S02', 'Posted', `Auto: posted on ${post.platform}`, user);
}

r.post('/requirements/:id/post', requireRole('recruiter', 'hr'), async (req, res) => {
  const reqm = await get('SELECT * FROM requirements WHERE id=?', req.params.id);
  if (!reqm) throw httpError(404, 'Requirement not found');
  if (reqm.jd_status !== 'Approved') throw httpError(400, 'Approve the JD first – then the job can be posted');
  if (reqm.status !== 'Open') throw httpError(400, 'Requirement is not open');
  const names = (req.body?.platforms || []).map((n) => String(n).toUpperCase());
  if (!names.length) throw httpError(400, 'Select at least one platform');
  const results = [];
  for (const name of names) {
    const p = await get('SELECT * FROM platforms WHERE name=?', name);
    if (!p) { results.push({ platform: name, status: 'Failed', error: 'Unknown platform' }); continue; }
    const link = await applyLink(reqm, p.name);
    const text = postText(reqm, link);
    const mode = p.method === 'assisted' || p.method === 'whatsapp' ? 'assisted' : 'auto';
    await run(`INSERT INTO job_posts(requirement_id, platform, mode, status, apply_link, created_at) VALUES(?,?,?, 'Pending', ?, ?)
               ON CONFLICT(requirement_id, platform) DO UPDATE SET status=CASE WHEN job_posts.status='Posted' THEN 'Posted' ELSE 'Pending' END, apply_link=excluded.apply_link, mode=excluded.mode`,
    reqm.id, p.name, mode, link, now());
    const post = await get('SELECT * FROM job_posts WHERE requirement_id=? AND platform=?', reqm.id, p.name);
    if (post.status === 'Posted') { results.push({ platform: p.name, status: 'Posted', note: 'already posted' }); continue; }

    if (p.method === 'careers') {
      await markPosted(post, req.user, `/careers?job=${reqm.code}`);
      results.push({ platform: p.name, status: 'Posted' });
    } else if (p.method === 'email') {
      const tpl = await get(`SELECT * FROM templates WHERE key='job_to_consultancy'`);
      const v = { designation: reqm.designation, company: reqm.company, salary: reqm.salary_range || '', openings: reqm.openings, code: reqm.code, jd: reqm.jd_text || '', apply_link: link };
      const out = await sendEmail({ to: p.email, subject: fillTemplate(tpl.subject, v), body: fillTemplate(tpl.body, v), template: tpl.key, user: req.user, queueIfManual: true, related_type: 'job_post', related_id: post.id });
      if (out.status === 'sent') { await markPosted(post, req.user, `email:${p.email}`); results.push({ platform: p.name, status: 'Posted' }); }
      else results.push({ platform: p.name, status: 'Pending', action: 'email', link: out.mailto, post_id: post.id, note: 'Email provider not set – opens your mail app' });
    } else if (p.method === 'api' && p.api_url) {
      try {
        const resp = await fetch(p.api_url, {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...(p.api_key ? { Authorization: `Bearer ${p.api_key}` } : {}) },
          body: JSON.stringify({ code: reqm.code, title: reqm.designation, company: reqm.company, location: reqm.location, salary: reqm.salary_range, openings: reqm.openings,
            experience: reqm.experience, qualification: reqm.qualification, skills: reqm.skills, description: reqm.jd_text, apply_link: link, post_text: text }),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 150)}`);
        let url = null; try { url = (await resp.json())?.url || null; } catch { /* no json */ }
        await markPosted(post, req.user, url);
        results.push({ platform: p.name, status: 'Posted' });
      } catch (e) {
        await run(`UPDATE job_posts SET status='Failed', error=? WHERE id=?`, e.message, post.id);
        results.push({ platform: p.name, status: 'Failed', error: e.message });
      }
    } else if (p.method === 'whatsapp') {
      results.push({ platform: p.name, status: 'Pending', action: 'whatsapp', link: `https://wa.me/?text=${encodeURIComponent(text)}`, post_id: post.id, text });
    } else {
      results.push({ platform: p.name, status: 'Pending', action: 'assisted', link: p.post_url, post_id: post.id, text });
    }
  }
  res.json({ results });
});

// confirm an assisted / WhatsApp / mail-app post, optionally with the live URL on the platform
r.post('/job-posts/:id/confirm', async (req, res) => {
  const post = await get('SELECT * FROM job_posts WHERE id=?', req.params.id);
  if (!post) throw httpError(404, 'Post not found');
  await markPosted(post, req.user, req.body?.post_url);
  res.json({ ok: true });
});
// manual record (posted outside the portal)
r.post('/requirements/:id/posts/manual', async (req, res) => {
  const reqm = await get('SELECT * FROM requirements WHERE id=?', req.params.id);
  const platform = String(req.body?.platform || '').toUpperCase();
  if (!reqm || !platform) throw httpError(400, 'Platform required');
  await run(`INSERT INTO job_posts(requirement_id, platform, mode, status, apply_link, created_at) VALUES(?,?, 'manual', 'Pending', ?, ?)
             ON CONFLICT(requirement_id, platform) DO UPDATE SET mode='manual'`, reqm.id, platform, await applyLink(reqm, platform), now());
  const post = await get('SELECT * FROM job_posts WHERE requirement_id=? AND platform=?', reqm.id, platform);
  await markPosted(post, req.user, req.body?.post_url);
  res.json({ ok: true });
});
r.post('/job-posts/:id/close', async (req, res) => {
  await run(`UPDATE job_posts SET status='Closed', closed_at=? WHERE id=?`, now(), req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ outbox
r.get('/outbox', async (req, res) => {
  const status = req.query.status || 'queued';
  const where = status === 'all' ? '1=1' : status === 'problem' ? `m.status IN ('queued','failed')` : 'm.status=?';
  const rows = await all(`SELECT m.*, c.name AS candidate_name, c.code AS candidate_code, a.name AS automation_name FROM messages m
    LEFT JOIN candidates c ON c.id=m.candidate_id LEFT JOIN automations a ON a.id = CAST(m.automation AS INTEGER)
    WHERE ${where} ORDER BY m.id DESC LIMIT 300`, ...(status === 'all' || status === 'problem' ? [] : [status]));
  const counts = await all('SELECT status, COUNT(*) n FROM messages GROUP BY status');
  res.json({ rows, counts, email_ready: await emailConfigured(), whatsapp_ready: await whatsappConfigured() });
});
r.post('/outbox/:id/retry', async (req, res) => {
  const out = await retryMessage(Number(req.params.id));
  if (out?.status === 'sent') await afterManualSend(await get('SELECT * FROM messages WHERE id=?', req.params.id));
  res.json(out);
});
// user opened the wa.me / mailto link and sent it by hand
r.post('/outbox/:id/sent', async (req, res) => {
  await run(`UPDATE messages SET status='sent-manual', sent_at=?, user_id=COALESCE(user_id, ?) WHERE id=?`, now(), req.user.id, req.params.id);
  const m = await get('SELECT * FROM messages WHERE id=?', req.params.id);
  await afterManualSend(m);
  if (m?.related_type === 'job_post' && m.related_id) {
    const post = await get('SELECT * FROM job_posts WHERE id=?', m.related_id);
    if (post && post.status !== 'Posted') await markPosted(post, req.user, `email:${m.to_addr}`);
  }
  res.json({ ok: true });
});
r.post('/outbox/:id/skip', async (req, res) => {
  await run(`UPDATE messages SET status='skipped' WHERE id=?`, req.params.id);
  res.json({ ok: true });
});

// ------------------------------------------------------------------ automations
r.get('/automations', async (req, res) => res.json({
  rules: await all('SELECT * FROM automations ORDER BY event, channel'), events: EVENTS, recipients: RECIPIENTS,
  templates: await all('SELECT key, name, channel FROM templates ORDER BY name'),
}));
r.put('/automations/:id', requireRole(), async (req, res) => {
  const b = req.body || {};
  await run('UPDATE automations SET enabled=COALESCE(?,enabled), template_key=COALESCE(?,template_key), name=COALESCE(?,name) WHERE id=?', b.enabled, b.template_key, b.name, req.params.id);
  res.json({ ok: true });
});
r.post('/automations', requireRole(), async (req, res) => {
  const b = req.body || {};
  if (!EVENTS[b.event] || !RECIPIENTS[b.recipient] || !b.template_key) throw httpError(400, 'Event, recipient and template are required');
  await run('INSERT INTO automations(event,name,channel,recipient,template_key,complete_step,enabled) VALUES(?,?,?,?,?,?,1)',
    b.event, b.name || `${EVENTS[b.event]} → ${b.recipient}`, b.channel || 'whatsapp', b.recipient, b.template_key, b.complete_step || null);
  res.json({ ok: true });
});
r.delete('/automations/:id', requireRole(), async (req, res) => { await run('DELETE FROM automations WHERE id=?', req.params.id); res.json({ ok: true }); });

// ------------------------------------------------------------------ bulk candidate work
// Excel / CSV rows (exported from Apna, Work India, Naukri…). Send in batches of ~25 rows.
r.post('/candidates/bulk-import', async (req, res) => {
  const { rows = [], requirement_id, source } = req.body || {};
  if (rows.length > 50) throw httpError(400, 'Send at most 50 rows per request');
  const out = { created: 0, duplicates: 0, errors: [] };
  for (const [i, row] of rows.entries()) {
    try {
      const resu = await createCandidate({ ...row, requirement_id: row.requirement_id || requirement_id, source: row.source || source }, { user: req.user, channel: 'import' });
      if (resu.duplicate) out.duplicates++; else out.created++;
    } catch (e) { out.errors.push({ row: i + 1, error: e.message }); }
  }
  res.json(out);
});

// Bulk result for the current step, e.g. accept / reject screening for many candidates at once
r.post('/candidates/bulk-action', async (req, res) => {
  const { ids = [], step = 'S04', result, remark } = req.body || {};
  if (!ids.length || !result) throw httpError(400, 'Select candidates and a result');
  const out = { done: 0, skipped: 0, errors: [] };
  for (const id of ids.slice(0, 100)) {
    const inst = await get(`SELECT id FROM step_instances WHERE entity_type='candidate' AND entity_id=? AND step_code=? AND state='pending'`, id, step);
    if (!inst) { out.skipped++; continue; }
    try { await completeStep(inst.id, { result, remark: remark || 'Bulk update' }, req.user); out.done++; } catch (e) { out.errors.push({ id, error: e.message }); }
  }
  res.json(out);
});

r.post('/candidates/:id/screen', async (req, res) => {
  const out = await autoScreen(Number(req.params.id), req.user);
  if (!out) throw httpError(404, 'Candidate not found');
  res.json(out);
});

export default r;
