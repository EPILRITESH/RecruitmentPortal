// One entry point for every way a candidate can arrive:
// manual form, careers page / platform apply link, webhook (Zapier / partner API), Excel import, bulk resumes.
import crypto from 'node:crypto';
import { get, run, now, nextCode, logActivity, setting } from './db.js';
import { startWorkflow, autoCompleteStep } from './workflow.js';
import { screenCandidate } from './ai.js';
import { runAutomations } from './automation.js';

export const normMobile = (m) => String(m || '').replace(/\D/g, '').slice(-10);

let bg = (p) => { p.catch((e) => console.error('[background]', e.message)); };
/** worker.js plugs in Cloudflare's waitUntil so background work survives the response */
export function setBackground(fn) { bg = fn; }
export const background = (p) => bg(p);

/**
 * Create a candidate. Returns { id, code } or { duplicate: true, existing }.
 * opts: { user, channel, force, resume_path, autoScreen = true }
 */
export async function createCandidate(b, opts = {}) {
  const mobile = normMobile(b.mobile);
  if (!b.name || mobile.length !== 10) throw Object.assign(new Error('Name and a 10-digit mobile number are required'), { status: 400 });
  const reqId = b.requirement_id ? Number(b.requirement_id) : null;
  const dup = await get(`SELECT id, code, status FROM candidates WHERE substr(replace(replace(mobile,' ',''),'-',''), -10)=? AND requirement_id IS ?`, mobile, reqId);
  if (dup && !opts.force) return { duplicate: true, existing: dup };

  const source = String(b.source || 'CAREERS PAGE / WALK-IN').trim().toUpperCase();
  const plat = await get('SELECT method, email FROM platforms WHERE name=?', source);
  const src = await get(`SELECT email FROM masters WHERE type='source' AND name=?`, source);
  const code = await nextCode('candidates', 'OUT', 2891);
  const x = await run(`INSERT INTO candidates(code, requirement_id, name, mobile, email, source, consultancy_email, current_company, experience_years, current_ctc, expected_ctc,
                 notice_period, location, qualification, skills, resume_path, resume_url, resume_text, apply_token, channel, created_by, created_at)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    code, reqId, String(b.name).trim(), mobile, b.email || null, source, b.consultancy_email || (plat?.method === 'email' ? plat.email : null) || src?.email || null,
    b.current_company || null, b.experience_years ? Number(b.experience_years) || null : null, b.current_ctc || null, b.expected_ctc || null, b.notice_period || null,
    b.location || null, b.qualification || null, Array.isArray(b.skills) ? b.skills.join(', ') : b.skills || null, opts.resume_path || null, b.resume_url || null,
    b.resume_text || null, crypto.randomBytes(9).toString('base64url'), opts.channel || 'manual', opts.user?.id ?? null, now());
  const id = Number(x.lastInsertRowid);
  await startWorkflow('candidate', id);
  await logActivity('candidate', id, opts.channel && opts.channel !== 'manual' ? `Applied via ${opts.channel}` : 'Candidate added', `Source: ${source}`, opts.user?.id);
  await runAutomations('candidate.created', { candidate_id: id });
  if (opts.autoScreen !== false && (await setting('auto_screen', 'score')) !== 'off') background(autoScreen(id));
  return { id, code };
}

/** Score the candidate; in "decide" mode also complete Step 4 when the score is clear. */
export async function autoScreen(id, user) {
  const c = await get('SELECT * FROM candidates WHERE id=?', id);
  if (!c) return null;
  const reqm = c.requirement_id ? await get('SELECT * FROM requirements WHERE id=?', c.requirement_id) : null;
  const out = await screenCandidate(c, reqm, user);
  const score = Math.round(out.score);
  await run('UPDATE candidates SET ai_score=?, ai_summary=?, ai_questions=? WHERE id=?', score,
    JSON.stringify({ verdict: out.verdict, strengths: out.strengths, gaps: out.gaps, summary: out.summary, mode: out._mode }), JSON.stringify(out.questions), id);
  await logActivity('candidate', id, `Screening score ${score}/100 (${out.verdict})`, out._mode === 'claude' ? 'AI' : 'Keyword match', user?.id);

  const mode = await setting('auto_screen', 'score');
  if (mode === 'decide') {
    const accept = Number(await setting('screen_accept', 70));
    const reject = Number(await setting('screen_reject', 30));
    if (score >= accept) await autoCompleteStep('candidate', id, 'S04', 'Accepted', `Auto-screening: score ${score} ≥ ${accept}`, user);
    else if ((await setting('auto_reject', '0')) === '1' && score < reject) await autoCompleteStep('candidate', id, 'S04', 'Rejected', `Auto-screening: score ${score} < ${reject}`, user);
  }
  return { ...out, score };
}
