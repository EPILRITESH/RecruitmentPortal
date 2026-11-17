import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessageCircle, Mail, Phone, Sparkles, FileText, Link2, Copy, RotateCcw, Pencil, Save, Upload, CalendarClock } from 'lucide-react';
import { api, auth, fileUrl, fmtDate, relTime } from '../api';
import { useApi, Spinner, Card, Button, StatusBadge, Badge, Field, ErrorBox, toast, Modal } from '../components/ui';
import { StepTracker, TaskModal } from '../components/workflow';
import MessageModal from '../components/MessageModal';

const FIELDS = [
  ['mobile', 'Mobile'], ['email', 'Email'], ['source', 'Source'], ['consultancy_email', 'Consultancy email'], ['current_company', 'Current company'],
  ['experience_years', 'Experience (yrs)'], ['qualification', 'Qualification'], ['current_ctc', 'Current salary'], ['expected_ctc', 'Expected salary'],
  ['notice_period', 'Notice period'], ['location', 'Location'], ['skills', 'Skills'], ['interviewer', 'Interviewer'], ['offered_salary', 'Offered salary'],
];

export default function CandidateDetail() {
  const { id } = useParams();
  const { data, loading, reload, error } = useApi(`/candidates/${id}`, [id]);
  const [task, setTask] = useState(null);
  const [msg, setMsg] = useState(null);
  const [screening, setScreening] = useState(false);
  const [edit, setEdit] = useState(null);
  const [aiErr, setAiErr] = useState(null);
  const [iv, setIv] = useState(null);

  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Spinner />;
  const c = data.candidate;
  const applyLink = `${window.location.origin}/apply/${c.apply_token}`;
  const summary = c.ai_summary;

  const screen = async () => {
    setScreening(true); setAiErr(null);
    try { const r = await api(`/candidates/${id}/screen`, { method: 'POST' }); toast(`AI score ${Math.round(r.score)}/100 – ${r.verdict}`); reload(); }
    catch (e) { setAiErr(e.message); } finally { setScreening(false); }
  };
  const emailConsultancy = async () => {
    const r = await api(`/candidates/${id}/email-consultancy`, { method: 'POST' });
    if (r.mailto) window.location.href = r.mailto;
    toast(r.status === 'sent' ? 'Email sent to consultancy' : 'SMTP not set – opened in your mail app'); reload();
  };
  const saveEdit = async () => { await api(`/candidates/${id}`, { method: 'PUT', body: edit }); setEdit(null); toast('Saved'); reload(); };
  const reopen = async () => {
    const remark = prompt('Why re-open this candidate?');
    if (remark === null) return;
    await api(`/candidates/${id}/reopen`, { method: 'POST', body: { remark } }); toast('Candidate re-opened'); reload();
  };
  const uploadResume = async (f) => {
    const form = new FormData(); form.append('resume', f);
    await api(`/candidates/${id}/resume`, { method: 'POST', form }); toast('Resume uploaded'); reload();
  };

  const pending = data.steps.find((s) => s.instance?.state === 'pending');
  const templateFor = { S05: 'interest', S06: 'apply_form', S07: 'interview', S11: 'selection' }[pending?.code] || '';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link to="/candidates" className="hover:underline">Candidates</Link> / {c.code}</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{c.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={c.status} /><Badge color="indigo">{c.stage}</Badge>
            {c.req_code ? <span>for <Link className="link" to={`/requirements/${c.requirement_id}`}>{c.req_code} · {c.designation} – {c.company}</Link></span> : <span>General pool</span>}
            {data.onboarding && <Link className="link" to={`/onboarding/${data.onboarding.id}`}>→ Onboarding {data.onboarding.code}</Link>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {c.status === 'Active' && <Button variant="secondary" icon={CalendarClock} onClick={() => setIv({ interview_at: c.interview_at?.replace(' ', 'T').slice(0, 16) || '', interviewer: c.interviewer || '' })}>{c.interview_at ? 'Re-schedule interview' : 'Schedule interview'}</Button>}
          <a href={`tel:${c.mobile}`}><Button variant="secondary" icon={Phone}>Call</Button></a>
          <Button variant="whatsapp" icon={MessageCircle} onClick={() => setMsg(templateFor || 'x')}>WhatsApp</Button>
          <Button variant="secondary" icon={Mail} onClick={() => setMsg('email')}>Email</Button>
          {['Rejected', 'Dropped', 'Future Hold'].includes(c.status) && ['admin', 'recruiter', 'approver'].includes(auth.user?.role) && <Button variant="secondary" icon={RotateCcw} onClick={reopen}>Re-open</Button>}
        </div>
      </div>

      {data.duplicates.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Same mobile also exists as: {data.duplicates.map((d) => <Link key={d.id} to={`/candidates/${d.id}`} className="ml-1 underline">{d.code} ({d.designation || 'pool'}, {d.status})</Link>)}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Recruitment steps (Outward)" actions={pending && <Badge color="amber">Waiting: {pending.short_name}</Badge>}>
            <StepTracker steps={data.steps} onAction={setTask} />
            {pending?.code === 'S12' && c.consultancy_email && (
              <div className="mt-3 flex items-center gap-2 rounded-lg bg-indigo-50 p-3 text-sm">
                <Mail className="h-4 w-4 text-indigo-500" /> Send selection email to <b>{c.consultancy_email}</b>
                <Button size="sm" className="ml-auto" onClick={emailConsultancy}>Send now</Button>
              </div>
            )}
          </Card>

          <Card title="AI Screening & Match" actions={<Button size="sm" variant="secondary" icon={Sparkles} onClick={screen} loading={screening}>{c.ai_score != null ? 'Re-run' : 'Run AI screening'}</Button>}>
            <ErrorBox error={aiErr} />
            {c.ai_score == null ? <p className="text-sm text-slate-500">Compares the candidate with the JD and requirement – gives a match score, strengths, gaps and phone-screening questions.</p> : (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <div className={`grid h-16 w-16 place-items-center rounded-full text-xl font-semibold ${c.ai_score >= 70 ? 'bg-emerald-50 text-emerald-700' : c.ai_score >= 45 ? 'bg-amber-50 text-amber-700' : 'bg-rose-50 text-rose-700'}`}>{c.ai_score}</div>
                  <div><div className="font-medium text-slate-800">{summary?.verdict}</div><p className="text-sm text-slate-600">{summary?.summary}</p>{summary?.mode === 'offline' && <p className="text-xs text-slate-400">Offline keyword match</p>}</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><div className="label text-emerald-700">Strengths</div><ul className="list-disc pl-5 text-sm text-slate-600">{summary?.strengths?.map((s) => <li key={s}>{s}</li>)}</ul></div>
                  <div><div className="label text-rose-700">Gaps</div><ul className="list-disc pl-5 text-sm text-slate-600">{summary?.gaps?.map((s) => <li key={s}>{s}</li>)}</ul></div>
                </div>
                {c.ai_questions?.length > 0 && (
                  <div><div className="label">Screening questions</div><ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">{c.ai_questions.map((q) => <li key={q}>{q}</li>)}</ol></div>
                )}
              </div>
            )}
          </Card>

          <Card title="Messages" bodyClass="p-0">
            {!data.messages.length ? <p className="p-4 text-sm text-slate-400">No messages yet.</p> : (
              <ul className="divide-y divide-slate-100">
                {data.messages.map((m) => (
                  <li key={m.id} className="px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      {m.channel === 'whatsapp' ? <MessageCircle className="h-3.5 w-3.5 text-[#1ebe5b]" /> : <Mail className="h-3.5 w-3.5" />}
                      {m.to_addr} · <Badge color={m.status === 'sent' ? 'green' : m.status === 'failed' ? 'red' : 'slate'}>{m.status}</Badge> · {m.user_name} · {relTime(m.created_at)}
                    </div>
                    {m.subject && <div className="mt-1 font-medium">{m.subject}</div>}
                    <div className="mt-1 whitespace-pre-wrap text-slate-600">{m.body}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Profile" actions={edit ? <Button size="sm" icon={Save} onClick={saveEdit}>Save</Button> : <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEdit({})}>Edit</Button>}>
            <dl className="space-y-2 text-sm">
              {FIELDS.map(([k, label]) => (
                <div key={k} className="grid grid-cols-5 gap-2">
                  <dt className="col-span-2 text-xs text-slate-400">{label}</dt>
                  <dd className="col-span-3 break-words text-slate-700">
                    {edit ? <input className="input !py-1" defaultValue={c[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /> : (c[k] || '—')}
                  </dd>
                </div>
              ))}
              <div className="grid grid-cols-5 gap-2"><dt className="col-span-2 text-xs text-slate-400">Interview</dt><dd className="col-span-3">{edit ? <input type="datetime-local" className="input !py-1" defaultValue={c.interview_at?.replace(' ', 'T').slice(0, 16)} onChange={(e) => setEdit({ ...edit, interview_at: e.target.value })} /> : fmtDate(c.interview_at)}</dd></div>
              <div className="grid grid-cols-5 gap-2"><dt className="col-span-2 text-xs text-slate-400">Joining date</dt><dd className="col-span-3">{edit ? <input type="date" className="input !py-1" defaultValue={c.joining_date?.slice(0, 10)} onChange={(e) => setEdit({ ...edit, joining_date: e.target.value })} /> : fmtDate(c.joining_date, false)}</dd></div>
            </dl>
          </Card>
          <Card title="Resume & application link">
            <div className="space-y-2 text-sm">
              {c.resume_path && <a className="link flex items-center gap-2" href={fileUrl(c.resume_path)} target="_blank" rel="noreferrer"><FileText className="h-4 w-4" />View uploaded resume</a>}
              {c.resume_url && <a className="link flex items-center gap-2" href={c.resume_url} target="_blank" rel="noreferrer"><Link2 className="h-4 w-4" />Resume link (Drive)</a>}
              <label className="flex cursor-pointer items-center gap-2 text-slate-600 hover:text-indigo-600"><Upload className="h-4 w-4" />Upload new resume<input type="file" className="hidden" onChange={(e) => e.target.files[0] && uploadResume(e.target.files[0])} /></label>
              <Field label="Candidate's self-fill form (Step 6 completes automatically)" className="pt-2">
                <div className="flex gap-1"><input className="input text-xs" readOnly value={applyLink} /><Button size="sm" variant="secondary" icon={Copy} onClick={() => { navigator.clipboard.writeText(applyLink); toast('Link copied'); }} /></div>
              </Field>
              <Button size="sm" variant="whatsapp" icon={MessageCircle} onClick={() => setMsg('apply_form')}>Send form link on WhatsApp</Button>
            </div>
          </Card>
          <Card title="Timeline" bodyClass="p-0">
            <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto text-sm">
              {data.activity.map((a) => <li key={a.id} className="px-4 py-2"><div>{a.action}</div><div className="text-xs text-slate-400">{a.user_name || 'System'} · {relTime(a.created_at)}{a.detail ? ` · ${a.detail}` : ''}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>

      {iv && (
        <Modal open onClose={() => setIv(null)} title="Schedule interview"
          footer={<><Button variant="secondary" onClick={() => setIv(null)}>Cancel</Button><Button disabled={!iv.interview_at} onClick={async () => {
            await api(`/candidates/${id}/schedule-interview`, { method: 'POST', body: iv });
            toast('Interview scheduled – invitation sent / queued'); setIv(null); reload();
          }}>Save & send invite</Button></>}>
          <div className="space-y-3">
            <Field label="Date & time"><input type="datetime-local" className="input" value={iv.interview_at} onChange={(e) => setIv({ ...iv, interview_at: e.target.value })} /></Field>
            <Field label="Interviewer"><input className="input" value={iv.interviewer} onChange={(e) => setIv({ ...iv, interviewer: e.target.value })} /></Field>
            <p className="text-xs text-slate-500">Step 7 gets this as its planned date. WhatsApp + email invitation go out automatically, and a reminder the day before.</p>
          </div>
        </Modal>
      )}
      {task && <TaskModal task={{ ...task, title: c.name, record_code: c.code, designation: c.designation, company: c.company }} onClose={() => setTask(null)} onDone={reload} />}
      {msg && <MessageModal open candidate={c} defaultTemplate={['x', 'email'].includes(msg) ? '' : msg} defaultChannel={msg === 'email' ? 'email' : 'whatsapp'} onClose={() => setMsg(null)} onSent={reload} />}
    </div>
  );
}
