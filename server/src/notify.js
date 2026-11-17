// Communication centre: Email (Brevo / Resend API, or SMTP on Node) + WhatsApp (Cloud API or click-to-chat link).
// When a channel is not configured the message is kept in the Outbox (status 'queued') with a one-click link.
import { get, run, now, setting, parse } from './db.js';

export const DEFAULT_TEMPLATES = [
  { key: 'interest', name: 'Job opportunity – interested?', channel: 'whatsapp', subject: '',
    body: 'Hello {{name}}, this is {{recruiter}} from EPIL HR. We have an opening for *{{designation}}* at {{company}} (Salary: {{salary}}). Are you interested? Please reply YES / NO.' },
  { key: 'apply_form', name: 'Send application form link', channel: 'whatsapp', subject: '',
    body: 'Hello {{name}}, thank you for your interest in *{{designation}}* at {{company}}. Please fill this short form and attach your resume: {{apply_link}}' },
  { key: 'interview', name: 'Interview invitation', channel: 'whatsapp', subject: '',
    body: 'Hello {{name}}, your interview for *{{designation}}* at {{company}} is scheduled on *{{interview_at}}*. Please carry your resume and ID proof. Location: {{location}}. Reply OK to confirm.' },
  { key: 'interview_reminder', name: 'Interview reminder (1 day before)', channel: 'whatsapp', subject: '',
    body: 'Reminder: {{name}}, your interview for {{designation}} is tomorrow ({{interview_at}}). Please confirm you are coming. – EPIL HR' },
  { key: 'selection', name: 'Selection & joining details', channel: 'whatsapp', subject: '',
    body: 'Congratulations {{name}}! 🎉 You are selected for *{{designation}}* at {{company}}. Joining date: *{{joining_date}}*. Please bring Aadhaar, PAN, photos, bank details and education certificates.' },
  { key: 'regret', name: 'Regret message', channel: 'whatsapp', subject: '',
    body: 'Hello {{name}}, thank you for your time and interest in {{designation}} at {{company}}. We will keep your profile for future openings. – EPIL HR' },
  { key: 'consultancy_selection', name: 'Selection email to consultancy', channel: 'email', subject: 'Candidate Selected – {{name}} ({{designation}}, {{company}})',
    body: 'Dear Team,\n\nWe are pleased to inform you that your candidate {{name}} ({{mobile}}) has been selected for the position of {{designation}} at {{company}}.\n\nJoining date: {{joining_date}}\nOffered salary: {{offered_salary}}\nReference: {{code}}\n\nPlease coordinate with the candidate for joining. Invoice may be raised as per agreed terms after the candidate completes the replacement period.\n\nRegards,\nHR Team – EPIL' },
  { key: 'feedback', name: 'Joinee feedback form', channel: 'whatsapp', subject: '',
    body: 'Hello {{name}}, welcome to {{company}}! Please share your first-week feedback here: {{feedback_link}} – EPIL HR' },
  { key: 'welcome', name: 'Welcome on joining day', channel: 'whatsapp', subject: '',
    body: 'Welcome to {{company}}, {{name}}! 🎉 We are happy to have you as {{designation}}. Your buddy and HR team will guide you today. – EPIL HR' },
  { key: 'interview_email', name: 'Interview invitation (email)', channel: 'email', subject: 'Interview for {{designation}} – {{company}}',
    body: 'Dear {{name}},\n\nYour interview for the position of {{designation}} at {{company}} is scheduled on {{interview_at}}.\nVenue: {{location}}\n\nPlease carry your updated resume and a photo ID.\n\nRegards,\nHR Team – EPIL' },
  { key: 'job_to_consultancy', name: 'New vacancy to consultancy', channel: 'email', subject: 'New vacancy – {{designation}} ({{company}})',
    body: 'Dear Team,\n\nPlease share suitable profiles for the following vacancy.\n\nPosition: {{designation}}\nCompany: {{company}}\nSalary: {{salary}}\nOpenings: {{openings}}\nReference: {{code}}\n\n{{jd}}\n\nCandidates can also apply directly here: {{apply_link}}\n\nRegards,\nHR Team – EPIL' },
  { key: 'hold_alert', name: 'Hold decision needed (to Ritesh Sir)', channel: 'email', subject: 'Hold decision needed – {{name}} ({{designation}})',
    body: 'Dear Sir,\n\nCandidate {{name}} ({{code}}) for {{designation}} – {{company}} is on HOLD after the interview.\nPlease decide in the portal: {{portal_link}}\n\nRemark: {{remark}}\n\n– Recruitment Portal' },
  { key: 'new_requirement', name: 'New requirement raised (to recruiter)', channel: 'email', subject: 'New requirement {{code}} – {{designation}} ({{company}})',
    body: 'A new requirement has been raised.\n\n{{code}} – {{designation}} at {{company}}\nSalary: {{salary}} | Openings: {{openings}}\nRequested by: {{requirement_by}}\n\nOpen in portal: {{portal_link}}' },
  { key: 'daily_digest', name: 'Daily task digest (to each doer)', channel: 'email', subject: 'Your recruitment tasks – {{today}}',
    body: 'Good morning {{doer}},\n\nYou have {{overdue}} overdue and {{due}} due-today steps.\n\n{{list}}\n\nOpen My Tasks: {{portal_link}}/tasks' },
];

export async function seedTemplates() {
  for (const t of DEFAULT_TEMPLATES) {
    await run('INSERT INTO templates(key,name,channel,subject,body) VALUES(?,?,?,?,?) ON CONFLICT(key) DO NOTHING', t.key, t.name, t.channel, t.subject, t.body);
  }
}

export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '') === '' ? `[${k}]` : vars[k]);
}

export async function candidateVars(candidateId, extra = {}) {
  const c = await get(`SELECT c.*, r.designation, r.company, r.salary_range, r.location AS job_location FROM candidates c
                 LEFT JOIN requirements r ON r.id = c.requirement_id WHERE c.id=?`, candidateId);
  if (!c) return {};
  const base = await setting('public_url', 'http://localhost:4000');
  const pretty = (s) => (s ? parse(s).toLocaleString('en-IN', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: s.length > 10 ? 'short' : undefined }) : '');
  return {
    name: c.name, mobile: c.mobile, code: c.code, designation: c.designation || '', company: c.company || '', salary: c.salary_range || '',
    interview_at: pretty(c.interview_at), joining_date: c.joining_date ? pretty(c.joining_date) : '', offered_salary: c.offered_salary || '',
    location: c.job_location || (await setting('office_address', 'Our office')),
    apply_link: c.apply_token ? `${base}/apply/${c.apply_token}` : '',
    feedback_link: c.apply_token ? `${base}/feedback/${c.apply_token}` : '',
    ...extra,
  };
}

export function waNumber(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

async function logMessage(m) {
  const r = await run(`INSERT INTO messages(candidate_id, channel, to_addr, subject, body, template, status, error, user_id, created_at, automation, link, sent_at, related_type, related_id)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    m.candidate_id ?? null, m.channel, m.to, m.subject ?? null, m.body, m.template ?? null, m.status, m.error ?? null, m.user?.id ?? null, now(),
    m.automation ?? null, m.link ?? null, m.status === 'sent' ? now() : null, m.related_type ?? null, m.related_id ?? null);
  return Number(r.lastInsertRowid);
}

export async function whatsappConfigured() {
  return (await setting('whatsapp_mode', 'link')) === 'cloud' && !!(await setting('whatsapp_token')) && !!(await setting('whatsapp_phone_id'));
}
export async function emailConfigured() {
  const p = await setting('email_provider', '');
  if (p === 'brevo' || p === 'resend') return !!(await setting('email_api_key'));
  if (p === 'smtp') return !!(await setting('smtp_host'));
  return false;
}

/** Deliver one WhatsApp message now (Cloud API) or keep it in the Outbox with a wa.me link. */
export async function sendWhatsApp({ to, body, candidate_id, template, user, automation, queueIfManual = false, related_type, related_id }) {
  const number = waNumber(to);
  if (!number) throw Object.assign(new Error('Mobile number missing'), { status: 400 });
  const link = `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
  let status = queueIfManual ? 'queued' : 'opened-link';
  let error = null;
  if (await whatsappConfigured()) {
    try {
      const token = await setting('whatsapp_token');
      const phoneId = await setting('whatsapp_phone_id');
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body } }),
      });
      if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${(await r.text()).slice(0, 200)}`);
      status = 'sent';
    } catch (e) { status = queueIfManual ? 'queued' : 'failed'; error = e.message; }
  }
  const id = await logMessage({ candidate_id, channel: 'whatsapp', to: number, body, template, status, error, user, automation, link, related_type, related_id });
  return { id, status, link: status === 'sent' ? null : link, error };
}

async function deliverEmail({ to, subject, body }) {
  const provider = await setting('email_provider', '');
  const from = (await setting('smtp_from')) || (await setting('smtp_user')) || '';
  const fromName = (await setting('company_name', 'EPIL Group')) + ' HR';
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">${String(body).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>`;
  if (provider === 'brevo') {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST', headers: { 'api-key': await setting('email_api_key'), 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ sender: { email: from, name: fromName }, to: String(to).split(',').map((e) => ({ email: e.trim() })), subject, htmlContent: html, textContent: body }),
    });
    if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  if (provider === 'resend') {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${await setting('email_api_key')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${from}>`, to: String(to).split(',').map((e) => e.trim()), subject, html, text: body }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  if (provider === 'smtp') {
    const nodemailer = (await import('nodemailer')).default;
    const t = nodemailer.createTransport({
      host: await setting('smtp_host'), port: Number(await setting('smtp_port', 587)), secure: (await setting('smtp_secure', '0')) === '1',
      auth: { user: await setting('smtp_user'), pass: await setting('smtp_pass') },
    });
    await t.sendMail({ from, to, subject, text: body, html });
    return;
  }
  throw new Error('Email not configured (Settings → Communication)');
}

/** Send an email now, or keep it in the Outbox (with a mailto link) when no provider is set. */
export async function sendEmail({ to, subject, body, candidate_id, template, user, automation, queueIfManual = false, related_type, related_id }) {
  if (!to) throw Object.assign(new Error('Email address missing'), { status: 400 });
  const link = `mailto:${to}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body)}`;
  let status = 'queued';
  let error = null;
  if (await emailConfigured()) {
    try { await deliverEmail({ to, subject, body }); status = 'sent'; } catch (e) { status = queueIfManual ? 'queued' : 'failed'; error = e.message; }
  } else {
    error = 'Email provider not set – send from the Outbox';
  }
  const id = await logMessage({ candidate_id, channel: 'email', to, subject, body, template, status, error, user, automation, link, related_type, related_id });
  return { id, status, error, mailto: status === 'sent' ? null : link };
}

/** Retry a queued / failed message through the configured provider. */
export async function retryMessage(id) {
  const m = await get('SELECT * FROM messages WHERE id=?', id);
  if (!m) return null;
  try {
    if (m.channel === 'email') {
      if (!(await emailConfigured())) return { status: m.status, link: m.link };
      await deliverEmail({ to: m.to_addr, subject: m.subject, body: m.body });
    } else {
      if (!(await whatsappConfigured())) return { status: m.status, link: m.link };
      const r = await fetch(`https://graph.facebook.com/v21.0/${await setting('whatsapp_phone_id')}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${await setting('whatsapp_token')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to_addr, type: 'text', text: { body: m.body } }),
      });
      if (!r.ok) throw new Error(`WhatsApp API ${r.status}`);
    }
    await run(`UPDATE messages SET status='sent', sent_at=?, error=NULL WHERE id=?`, now(), id);
    return { status: 'sent' };
  } catch (e) {
    await run(`UPDATE messages SET status='failed', error=? WHERE id=?`, e.message, id);
    return { status: 'failed', error: e.message, link: m.link };
  }
}
