// Recruitment AI agents (Claude or free Cloudflare Workers AI). Every agent has an offline fallback so the portal
// keeps working without an API key – the AI just makes each step faster.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { run, now, setting } from './db.js';

export const AGENTS = {
  jd: 'JD Generator Agent',
  cv: 'CV Parser Agent',
  screen: 'Screening & Match Agent',
  message: 'Outreach Message Agent',
  assistant: 'Recruitment Assistant (Ask anything)',
};

async function apiKey() {
  return process.env.ANTHROPIC_API_KEY || (await setting('anthropic_api_key')) || '';
}

// Two providers: Claude (Anthropic API, needs credits) or Cloudflare Workers AI (free daily allowance, binding env.AI)
let workersAI = null;
export function setWorkersAI(binding) { workersAI = binding || null; }
export const WORKERS_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export async function provider() {
  const p = await setting('ai_provider', '');
  if (p === 'claude' || p === 'workers') return p;
  return workersAI ? 'workers' : 'claude';
}
export const aiAvailable = async () => ((await provider()) === 'workers' ? !!workersAI : !!(await apiKey()));
// on unless it was switched off explicitly ('0'); empty values from older saves count as on
export const agentEnabled = async (agent) => (await setting(`ai_enabled_${agent}`, '1')) !== '0';
const model = async () => (await setting('ai_model', 'claude-opus-5-5')) || 'claude-opus-5-5';

async function callClaude({ system, content, schema, effort = 'medium' }) {
  const client = new Anthropic({ apiKey: await apiKey() });
  const response = await client.beta.messages.parse({
    model: await model(),
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system,
    output_config: { effort, format: betaZodOutputFormat(schema) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error('AI declined this request');
  if (!response.parsed_output) throw new Error('AI returned an unexpected format');
  return response.parsed_output;
}

/** Content blocks (text / PDF / image) -> plain text for Workers AI. PDFs are converted with the free toMarkdown. */
async function contentToText(content) {
  if (typeof content === 'string') return content;
  const parts = [];
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text);
    else if (b.type === 'document') {
      const out = await workersAI.toMarkdown({ name: 'resume.pdf', blob: new Blob([Buffer.from(b.source.data, 'base64')], { type: 'application/pdf' }) });
      const r = Array.isArray(out) ? out[0] : out;
      if (r?.format === 'error' || !r?.data) throw new Error(`Could not read the PDF${r?.error ? `: ${r.error}` : ''}`);
      parts.push(`Resume text:\n${r.data.replace(/## Metadata[\s\S]*?## Contents/, '').slice(0, 14000)}`);
    } else if (b.type === 'image') {
      throw new Error('Photo / scanned resumes need the Claude provider – upload a PDF or Word file');
    }
  }
  return parts.join('\n\n');
}

async function callWorkersAI({ system, content, schema }) {
  if (!workersAI) throw new Error('Workers AI is only available on Cloudflare');
  const jsonSchema = z.toJSONSchema(schema);
  delete jsonSchema.$schema;
  const text = (await contentToText(content)).slice(0, 30000);
  const res = await workersAI.run((await setting('ai_workers_model', '')) || WORKERS_MODEL, {
    messages: [
      { role: 'system', content: `${system}\nReply only with JSON that matches the requested schema.` },
      { role: 'user', content: text },
    ],
    response_format: { type: 'json_schema', json_schema: jsonSchema },
    max_tokens: 2500,
  });
  let out = res?.response ?? res;
  if (typeof out === 'string') {
    const m = out.match(/\{[\s\S]*\}/);
    out = JSON.parse(m ? m[0] : out);
  }
  const parsed = schema.safeParse(out);
  if (!parsed.success) throw new Error('Free AI model returned an unexpected format – please try again');
  return parsed.data;
}

/** One entry point for every agent */
async function callModel(args) {
  return (await provider()) === 'workers' ? callWorkersAI(args) : callClaude(args);
}

function logRun(agent, entity_type, entity_id, input, output, mode, user_id) {
  return run('INSERT INTO ai_runs(agent, entity_type, entity_id, input, output, mode, user_id, created_at) VALUES(?,?,?,?,?,?,?,?)',
    agent, entity_type ?? null, entity_id ?? null, JSON.stringify(input).slice(0, 4000), JSON.stringify(output).slice(0, 8000), mode, user_id ?? null, now());
}

async function withFallback(agent, ctx, claudeFn, offlineFn) {
  if ((await aiAvailable()) && (await agentEnabled(agent))) {
    try {
      const out = await claudeFn();
      const mode = (await provider()) === 'workers' ? 'workers-ai' : 'claude';
      await logRun(agent, ctx.entity_type, ctx.entity_id, ctx.input, out, mode, ctx.user_id);
      return { ...out, _mode: mode };
    } catch (e) {
      console.error(`[ai:${agent}]`, e.message);
      const out = offlineFn();
      await logRun(agent, ctx.entity_type, ctx.entity_id, ctx.input, out, 'offline', ctx.user_id);
      return { ...out, _mode: 'offline', _error: e.message };
    }
  }
  const out = offlineFn();
  await logRun(agent, ctx.entity_type, ctx.entity_id, ctx.input, out, 'offline', ctx.user_id);
  return { ...out, _mode: 'offline' };
}

const COMPANY_CONTEXT = `You work for the HR team of the EPIL group of companies in Surat, Gujarat, India
(EPIL Kosamba, EPIL Katargam, ATM Katargam, Swastik Sachin, Rachna Pandesara, Aerowaves LLP,
Radhadarshan Green LLP, Spacebox Warehousing LLP). Candidates are mostly sourced from Work India,
Apna Job, LinkedIn, staff references and local placement consultancies. Write in clear, simple
English that a Gujarati/Hindi speaking candidate can easily understand. Salaries are monthly in INR.`;

// ---------------------------------------------------------------------------
// 1. JD Generator
// ---------------------------------------------------------------------------
const JDSchema = z.object({
  title: z.string(),
  summary: z.string(),
  responsibilities: z.array(z.string()),
  requirements: z.array(z.string()),
  skills: z.array(z.string()),
  benefits: z.array(z.string()),
  job_post_short: z.string().describe('Short job post (max 600 chars) for Work India / Apna / WhatsApp groups, with emojis allowed'),
});

function jdToText(jd, r) {
  return [
    `JOB DESCRIPTION – ${jd.title}`,
    `Company: ${r.company}${r.location ? ' | Location: ' + r.location : ''}`,
    `Salary: ${r.salary_range || 'As per experience'} | Openings: ${r.openings || 1}`,
    r.experience ? `Experience: ${r.experience}` : null,
    r.qualification ? `Qualification: ${r.qualification}` : null,
    '',
    'About the role',
    jd.summary,
    '',
    'Key Responsibilities',
    ...jd.responsibilities.map((x) => `• ${x}`),
    '',
    'Requirements',
    ...jd.requirements.map((x) => `• ${x}`),
    '',
    'Skills',
    jd.skills.join(', '),
    '',
    'What we offer',
    ...jd.benefits.map((x) => `• ${x}`),
  ].filter((x) => x !== null).join('\n');
}

export async function generateJD(r, user) {
  const input = { designation: r.designation, company: r.company, salary: r.salary_range, experience: r.experience, qualification: r.qualification, skills: r.skills, notes: r.notes, location: r.location };
  const out = await withFallback('jd', { entity_type: 'requirement', entity_id: r.id, input, user_id: user?.id },
    () => callModel({
      system: `${COMPANY_CONTEXT}\nYou are the JD Generator agent. Produce a practical, honest job description for the vacancy. 5-8 responsibilities, 4-7 requirements. Do not invent benefits beyond standard ones (salary, PF/ESIC where applicable, growth, training) unless the notes mention them.`,
      content: `Vacancy details (JSON):\n${JSON.stringify(input, null, 2)}`,
      schema: JDSchema,
    }),
    () => {
      const skills = (r.skills || '').split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      return {
        title: r.designation,
        summary: `${r.company} is hiring a ${r.designation}. The candidate will handle day-to-day ${r.designation.toLowerCase()} work and report to the department head.`,
        responsibilities: [`Handle all daily ${r.designation} activities`, 'Maintain records and reports on time', 'Coordinate with team members and the reporting manager', 'Follow company policies, safety and quality standards', 'Complete tasks assigned in the FMS / checklist on time'],
        requirements: [r.qualification || 'Graduate / relevant qualification', r.experience ? `${r.experience} of experience` : 'Freshers / experienced can apply', 'Good communication in Gujarati / Hindi / English', 'Basic computer knowledge'],
        skills: skills.length ? skills : ['Communication', 'Discipline', 'Basic computer'],
        benefits: ['Salary as per company norms', 'PF / ESIC as applicable', 'Learning and growth opportunity'],
        job_post_short: `📢 Hiring: ${r.designation}\n🏢 ${r.company}\n💰 ${r.salary_range || 'As per experience'}\n📍 ${r.location || 'Surat'}\nInterested candidates send resume on WhatsApp.`,
      };
    });
  return { ...out, text: jdToText(out, r) };
}

// ---------------------------------------------------------------------------
// 2. CV Parser
// ---------------------------------------------------------------------------
const CVSchema = z.object({
  name: z.string(),
  mobile: z.string().describe('10-digit Indian mobile, digits only, empty if not found'),
  email: z.string(),
  current_company: z.string(),
  experience_years: z.number(),
  current_ctc: z.string().describe('current monthly salary as plain digits, e.g. 22000; empty if not mentioned'),
  expected_ctc: z.string().describe('expected monthly salary as plain digits, e.g. 27000; empty if not mentioned'),
  notice_period: z.string(),
  location: z.string(),
  qualification: z.string(),
  skills: z.array(z.string()),
  summary: z.string().describe('2-3 line profile summary'),
});

export async function parseCV({ buffer, mimetype, text }, user) {
  const input = { mimetype, size: buffer?.length, textLen: text?.length };
  return withFallback('cv', { input, user_id: user?.id },
    async () => {
      const content = [];
      if (mimetype === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } });
      else if (/^image\/(png|jpeg|webp|gif)$/.test(mimetype || '')) content.push({ type: 'image', source: { type: 'base64', media_type: mimetype, data: buffer.toString('base64') } });
      else if (workersAI && buffer && /word|officedocument|msword|rtf|opendocument/.test(mimetype || '')) {
        const out = await workersAI.toMarkdown({ name: 'resume.docx', blob: new Blob([buffer], { type: mimetype }) });
        const r = Array.isArray(out) ? out[0] : out;
        content.push({ type: 'text', text: `Resume text:\n${(r?.data || '').slice(0, 14000)}` });
      } else content.push({ type: 'text', text: `Resume text:\n${text || buffer?.toString('utf8') || ''}` });
      content.push({ type: 'text', text: 'Extract the candidate details from this resume. Use empty string / 0 when a value is missing. Never guess a phone number.' });
      return callModel({ system: `${COMPANY_CONTEXT}\nYou are the CV Parser agent.`, content, schema: CVSchema, effort: 'low' });
    },
    () => offlineParse(text || (mimetype?.startsWith('text') ? buffer?.toString('utf8') : '')));
}

function offlineParse(t = '') {
  const mobile = (t.match(/(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})/) || [])[1]?.replace(/\D/g, '') || '';
  const email = (t.match(/[\w.+-]+@[\w-]+\.[\w.]+/) || [])[0] || '';
  const exp = parseFloat((t.match(/(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)/i) || [])[1] || '0');
  const firstLine = t.split('\n').map((s) => s.trim()).find((s) => /^[A-Za-z .]{3,40}$/.test(s)) || '';
  return { name: firstLine, mobile, email, current_company: '', experience_years: exp, current_ctc: '', expected_ctc: '', notice_period: '', location: '', qualification: '', skills: [], summary: t ? 'Parsed without AI – please verify the details.' : 'No text found. Add ANTHROPIC_API_KEY to read PDF/image resumes automatically.' };
}

// ---------------------------------------------------------------------------
// 3. Screening & Match
// ---------------------------------------------------------------------------
const ScreenSchema = z.object({
  score: z.number().describe('0-100 match score against the JD'),
  verdict: z.enum(['Strong fit', 'Possible fit', 'Not a fit']),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  summary: z.string(),
  questions: z.array(z.string()).describe('6-8 phone screening / interview questions specific to this role and candidate'),
});

export async function screenCandidate(c, r, user) {
  const input = {
    job: r ? { designation: r.designation, company: r.company, salary: r.salary_range, experience: r.experience, qualification: r.qualification, skills: r.skills, jd: r.jd_text?.slice(0, 4000) } : null,
    candidate: { name: c.name, experience_years: c.experience_years, current_company: c.current_company, current_ctc: c.current_ctc, expected_ctc: c.expected_ctc, notice_period: c.notice_period, location: c.location, qualification: c.qualification, skills: c.skills, resume: c.resume_text?.slice(0, 8000) },
  };
  return withFallback('screen', { entity_type: 'candidate', entity_id: c.id, input, user_id: user?.id },
    () => callModel({
      system: `${COMPANY_CONTEXT}\nYou are the Screening agent. Score the candidate against the job fairly using only job-relevant facts (skills, experience, qualification, salary fit, notice period, location). Never use gender, religion, caste, age or marital status. Be concise.`,
      content: JSON.stringify(input, null, 2),
      schema: ScreenSchema,
    }),
    () => {
      const want = (r?.skills || r?.designation || '').toLowerCase().split(/[,;\s]+/).filter((w) => w.length > 1);
      const have = `${c.skills || ''} ${c.resume_text || ''} ${c.qualification || ''}`.toLowerCase();
      const hit = want.filter((w) => have.includes(w));
      const score = want.length ? Math.round((hit.length / want.length) * 70 + (c.experience_years ? 20 : 10)) : 50;
      return {
        score: Math.min(100, score),
        verdict: score >= 70 ? 'Strong fit' : score >= 45 ? 'Possible fit' : 'Not a fit',
        strengths: hit.length ? [`Matches: ${hit.join(', ')}`] : [],
        gaps: want.filter((w) => !have.includes(w)).slice(0, 5).map((w) => `No mention of ${w}`),
        summary: 'Keyword match (offline). Add an Anthropic API key for full AI screening.',
        questions: [
          'Tell me about your current / last job and daily work.',
          `Why do you want to join ${r?.company || 'our company'}?`,
          'What is your current and expected salary?',
          'What is your notice period? When can you join?',
          'Where do you stay? Is travelling to the work location okay?',
          `What experience do you have as ${r?.designation || 'this role'}?`,
        ],
      };
    });
}

// ---------------------------------------------------------------------------
// 4. Outreach message (WhatsApp / Email)
// ---------------------------------------------------------------------------
const MsgSchema = z.object({ subject: z.string(), body: z.string() });
export async function draftMessage({ purpose, channel, candidate, requirement, language = 'English' }, user) {
  const input = { purpose, channel, language, candidate: { name: candidate?.name, interview_at: candidate?.interview_at, joining_date: candidate?.joining_date }, job: requirement ? { designation: requirement.designation, company: requirement.company, salary: requirement.salary_range } : null };
  return withFallback('message', { entity_type: 'candidate', entity_id: candidate?.id, input, user_id: user?.id },
    () => callModel({
      system: `${COMPANY_CONTEXT}\nYou are the Outreach agent. Write a short, polite ${channel} message from the EPIL HR team. ${channel === 'whatsapp' ? 'Max 500 characters, no subject needed (return empty subject).' : 'Professional email with a subject.'} Language: ${language}.`,
      content: JSON.stringify(input),
      schema: MsgSchema,
      effort: 'low',
    }),
    () => ({ subject: `${purpose} – ${requirement?.designation || ''}`, body: `Dear ${candidate?.name || 'Candidate'},\n\nThis is regarding the ${requirement?.designation || ''} position at ${requirement?.company || 'EPIL'}. ${purpose}.\n\nRegards,\nHR Team, EPIL` }));
}

// ---------------------------------------------------------------------------
// 5. Recruitment Assistant – answers questions over a live data snapshot
// ---------------------------------------------------------------------------
const AskSchema = z.object({
  answer: z.string().describe('one or two sentence summary'),
  items: z.array(z.string()).describe('each matching record on its own entry, e.g. "IN-170 Accountant – EPIL Kosamba: 45 days open, 3 candidates"'),
  suggested_actions: z.array(z.string()),
});
export async function askAssistant(question, snapshot, user) {
  return withFallback('assistant', { input: { question }, user_id: user?.id },
    () => callModel({
      system: `${COMPANY_CONTEXT}\nYou are the Recruitment Assistant for the HR team. Answer using ONLY the data snapshot provided (it is live data from the portal). Write a one or two sentence summary in answer, and put every matching record in items (code, name and the relevant number such as days_open). Then suggest up to 4 concrete next actions.`,
      content: `Data snapshot (JSON):\n${JSON.stringify(snapshot)}\n\nQuestion: ${question}`,
      schema: AskSchema,
    }),
    () => ({
      items: [],
      answer: `AI is offline. Quick facts: ${snapshot.kpis.open_requirements} open requirements, ${snapshot.kpis.active_candidates} active candidates, ${snapshot.kpis.overdue_tasks} overdue tasks, ${snapshot.kpis.joined_this_month} joined this month.`,
      suggested_actions: ['Clear overdue tasks from the Rescue Board', 'Add an Anthropic API key in Settings → AI to enable the assistant'],
    }));
}
