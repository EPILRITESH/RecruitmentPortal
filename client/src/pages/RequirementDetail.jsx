import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Sparkles, Copy, Pencil, UserPlus, CheckCircle2, Send, MessageCircle } from 'lucide-react';
import { api, auth, fmtDate, relTime } from '../api';
import { useApi, Spinner, Card, Button, StatusBadge, Badge, Empty, Select, toast, ErrorBox } from '../components/ui';
import { StepTracker, TaskModal } from '../components/workflow';
import { RequirementForm, CandidateForm } from '../components/forms';
import JobPosting from '../components/JobPosting';

export default function RequirementDetail() {
  const { id } = useParams();
  const { data, loading, reload, error } = useApi(`/requirements/${id}`, [id]);
  const [task, setTask] = useState(null);
  const [edit, setEdit] = useState(false);
  const [addCand, setAddCand] = useState(false);
  const [jd, setJd] = useState('');
  const [post, setPost] = useState('');
  const [gen, setGen] = useState(false);
  const [jdErr, setJdErr] = useState(null);

  useEffect(() => { if (data) setJd(data.requirement.jd_text || ''); }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Spinner />;
  const r = data.requirement;
  const role = auth.user?.role;
  const canApprove = ['admin', 'hod', 'approver'].includes(role);

  const generate = async () => {
    setGen(true); setJdErr(null);
    try {
      const out = await api(`/requirements/${id}/generate-jd`, { method: 'POST' });
      setJd(out.text); setPost(out.job_post_short);
      toast(out._mode !== 'offline' ? 'JD written by AI – review & save' : 'Template JD created (AI offline)');
    } catch (e) { setJdErr(e.message); } finally { setGen(false); }
  };
  const saveJd = async (jd_status) => {
    await api(`/requirements/${id}`, { method: 'PUT', body: { jd_text: jd, ...(jd_status ? { jd_status } : {}) } });
    toast(jd_status ? `JD ${jd_status}` : 'JD saved'); reload();
  };
  const setStatus = async (status) => {
    const remark = status !== 'Open' ? prompt(`Reason for marking ${status}?`) : null;
    await api(`/requirements/${id}`, { method: 'PUT', body: { status, remark } });
    toast(`Requirement ${status}`); reload();
  };
  const copy = (t) => { navigator.clipboard.writeText(t); toast('Copied'); };

  const funnel = ['Active', 'Selected', 'Joined', 'Rejected', 'Dropped'].map((s) => ({ s, n: data.candidates.filter((c) => c.status === s).length }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link to="/requirements" className="hover:underline">Requirements</Link> / {r.code}</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{r.designation} <span className="font-normal text-slate-500">· {r.company}</span></h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={r.status} /><StatusBadge value={r.priority} />
            <span>Requested by <b className="text-slate-700">{r.requirement_by}</b> on {fmtDate(r.request_date, false)}</span>
            <span>· Filled {r.filled}/{r.openings}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
          <div className="w-36"><Select value={r.status} onChange={(e) => setStatus(e.target.value)} options={['Open', 'On Hold', 'Closed', 'Cancelled']} /></div>
          <Button icon={UserPlus} onClick={() => setAddCand(true)}>Add candidate</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title={<span>Job Description <Badge color={r.jd_status === 'Approved' ? 'green' : r.jd_status === 'Draft' ? 'slate' : 'amber'} className="ml-2">{r.jd_status}</Badge></span>}
            actions={<Button size="sm" variant="secondary" icon={Sparkles} onClick={generate} loading={gen}>{jd ? 'Re-write with AI' : 'Generate JD with AI'}</Button>}>
            <ErrorBox error={jdErr} />
            <textarea className="input min-h-[260px] font-mono text-[13px] leading-relaxed" value={jd} onChange={(e) => setJd(e.target.value)} placeholder="Click “Generate JD with AI” or write the JD here…" />
            {post && (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="mb-1 flex items-center justify-between text-xs font-semibold text-emerald-800">Short job post (Work India / Apna / WhatsApp)
                  <span className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={Copy} onClick={() => copy(post)}>Copy</Button>
                    <a href={`https://wa.me/?text=${encodeURIComponent(post)}`} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost" icon={MessageCircle}>Share</Button></a>
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-sm text-slate-700">{post}</pre>
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => saveJd()}>Save draft</Button>
              <Button size="sm" variant="secondary" icon={Copy} onClick={() => copy(jd)} disabled={!jd}>Copy JD</Button>
              {r.jd_status !== 'Approved' && <Button size="sm" variant="secondary" icon={Send} onClick={() => saveJd('Sent for approval')} disabled={!jd}>Send to HOD for approval</Button>}
              {canApprove && r.jd_status !== 'Approved' && <Button size="sm" variant="success" icon={CheckCircle2} onClick={() => saveJd('Approved')} disabled={!jd}>Approve JD</Button>}
            </div>
          </Card>

          <JobPosting requirement={r} onChange={reload} />

          <Card title={`Candidates (${data.candidates.length})`} bodyClass="p-0"
            actions={<div className="flex gap-1">{funnel.map((f) => f.n > 0 && <StatusBadge key={f.s} value={f.s} />)}</div>}>
            {!data.candidates.length ? <Empty text="No candidates yet – add from Work India, Apna, references…" /> : (
              <div className="max-h-[420px] overflow-y-auto">
                <table className="w-full">
                  <thead><tr><th className="th">ID</th><th className="th">Name</th><th className="th">Source</th><th className="th">Stage</th><th className="th text-right">AI</th><th className="th">Status</th></tr></thead>
                  <tbody>
                    {data.candidates.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="td"><Link className="link" to={`/candidates/${c.id}`}>{c.code}</Link></td>
                        <td className="td"><div className="font-medium">{c.name}</div><div className="text-xs text-slate-500">{c.mobile}</div></td>
                        <td className="td text-xs">{c.source}</td>
                        <td className="td text-xs">{c.stage}</td>
                        <td className="td text-right tabular-nums">{c.ai_score ?? '—'}</td>
                        <td className="td"><StatusBadge value={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Inward steps"><StepTracker steps={data.steps} onAction={setTask} /></Card>
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {[['Salary', r.salary_range], ['Department', r.department], ['Experience', r.experience], ['Qualification', r.qualification], ['Location', r.location], ['Target date', fmtDate(r.target_date, false)], ['Skills', r.skills], ['Notes', r.notes]].map(([k, v]) => (
                <div key={k} className={k === 'Skills' || k === 'Notes' ? 'col-span-2' : ''}><dt className="text-xs text-slate-400">{k}</dt><dd className="text-slate-700">{v || '—'}</dd></div>
              ))}
            </dl>
          </Card>
          <Card title="Activity" bodyClass="p-0">
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
              {data.activity.map((a) => <li key={a.id} className="px-4 py-2"><div>{a.action}</div><div className="text-xs text-slate-400">{a.user_name || 'System'} · {relTime(a.created_at)}{a.detail ? ` · ${a.detail}` : ''}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>

      {task && <TaskModal task={{ ...task, title: `${r.designation} – ${r.company}`, record_code: r.code }} onClose={() => setTask(null)} onDone={reload} />}
      {edit && <RequirementForm open initial={r} onClose={() => setEdit(false)} onSaved={reload} />}
      {addCand && <CandidateForm open requirementId={r.id} onClose={() => setAddCand(false)} onSaved={reload} />}
    </div>
  );
}
