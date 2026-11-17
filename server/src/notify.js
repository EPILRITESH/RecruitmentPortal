// Communication centre: Email (SMTP) + WhatsApp (click-to-chat link or WhatsApp Cloud API)
import nodemailer from 'nodemailer';
import { get, run, now, setting } from './db.js';

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
];

export function seedTemplates() {
  for (const t of DEFAULT_TEMPLATES) {
    run('INSERT INTO templates(key,name,channel,subject,body) VALUES(?,?,?,?,?) ON CONFLICT(key) DO NOTHING', t.key, t.name, t.channel, t.subject, t.body);
  }
}

export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? '') === '' ? `[${k}]` : vars[k]);
}

export function candidateVars(candidateId, extra = {}) {
  const c = get(`SELECT c.*, r.designation, r.company, r.salary_range, r.location AS job_location FROM candidates c
                 LEFT JOIN requirements r ON r.id = c.requirement_id WHERE c.id=?`, candidateId);
  if (!c) return {};
  const base = setting('public_url', 'http://localhost:4000');
  const pretty = (s) => (s ? new Date(String(s).replace(' ', 'T')).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: s.length > 10 ? 'short' : undefined }) : '');
  return {
    name: c.name, mobile: c.mobile, code: c.code, designation: c.designation || '', company: c.company || '', salary: c.salary_range || '',
    interview_at: pretty(c.interview_at), joining_date: c.joining_date ? pretty(c.joining_date) : '', offered_salary: c.offered_salary || '',
    location: c.job_location || setting('office_address', 'Our office'),
    apply_link: c.apply_token ? `${base}/apply/${c.apply_token}` : '',
    feedback_link: c.apply_token ? `${base}/feedback/${c.apply_token}` : '',
    ...extra,
  };
}

export function waNumber(mobile) {
  const d = String(mobile || '').replace(/\D/g, '');
  return d.length === 10 ? `91${d}` : d;
}

export async function sendWhatsApp({ to, body, candidate_id, template, user }) {
  const mode = setting('whatsapp_mode', 'link'); // link | cloud
  const number = waNumber(to);
  if (!number) throw new Error('Mobile number missing');
  let status = 'opened-link', error = null, link = `https://wa.me/${number}?text=${encodeURIComponent(body)}`;
  if (mode === 'cloud') {
    try {
      const token = setting('whatsapp_token');
      const phoneId = setting('whatsapp_phone_id');
      const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body } }),
      });
      if (!r.ok) throw new Error(`WhatsApp API ${r.status}: ${(await r.text()).slice(0, 200)}`);
      status = 'sent'; link = null;
    } catch (e) { status = 'failed'; error = e.message; }
  }
  run('INSERT INTO messages(candidate_id, channel, to_addr, body, template, status, error, user_id, created_at) VALUES(?,?,?,?,?,?,?,?,?)',
    candidate_id ?? null, 'whatsapp', number, body, template ?? null, status, error, user?.id ?? null, now());
  return { status, link, error };
}

function transport() {
  const host = setting('smtp_host');
  if (!host) return null;
  return nodemailer.createTransport({
    host, port: Number(setting('smtp_port', 587)), secure: setting('smtp_secure', '0') === '1',
    auth: { user: setting('smtp_user'), pass: setting('smtp_pass') },
  });
}

export async function sendEmail({ to, subject, body, candidate_id, template, user }) {
  const t = transport();
  let status = 'queued', error = null;
  if (!to) throw new Error('Email address missing');
  if (t) {
    try {
      await t.sendMail({ from: setting('smtp_from', setting('smtp_user')), to, subject, text: body });
      status = 'sent';
    } catch (e) { status = 'failed'; error = e.message; }
  } else {
    error = 'SMTP not configured (Settings → Communication). Use the mailto link.';
  }
  run('INSERT INTO messages(candidate_id, channel, to_addr, subject, body, template, status, error, user_id, created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
    candidate_id ?? null, 'email', to, subject ?? null, body, template ?? null, status, error, user?.id ?? null, now());
  return { status, error, mailto: status === 'sent' ? null : `mailto:${to}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body)}` };
}
