import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { MessageCircle, Phone } from 'lucide-react';
import { api, fmtDate, relTime, inr } from '../api';
import { useApi, Spinner, Card, Button, StatusBadge, Field, ErrorBox, toast } from '../components/ui';
import { StepTracker, TaskModal } from '../components/workflow';
import MessageModal from '../components/MessageModal';

export default function OnboardingDetail() {
  const { id } = useParams();
  const { data, loading, reload, error } = useApi(`/onboardings/${id}`, [id]);
  const [task, setTask] = useState(null);
  const [msg, setMsg] = useState(null);
  const [form, setForm] = useState(null);

  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Spinner />;
  const o = data.onboarding;
  const f = form || { joining_date: o.joining_date?.slice(0, 10) || '', buddy: o.buddy || '', department: o.department || '' };

  const toggle = async (item) => {
    const checklist = { ...o.checklist, [item]: !o.checklist[item] };
    await api(`/onboardings/${id}`, { method: 'PUT', body: { checklist } });
    reload();
  };
  const save = async () => {
    await api(`/onboardings/${id}`, { method: 'PUT', body: f });
    toast('Saved – step dates re-planned from joining date'); setForm(null); reload();
  };
  const doneCount = data.checklist_items.filter((i) => o.checklist[i]).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link to="/onboarding" className="hover:underline">Onboarding</Link> / {o.code}</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{o.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={o.status} /> {o.designation} – {o.company} · Joining {fmtDate(o.joining_date, false)} · <Link className="link" to={`/candidates/${o.candidate_id}`}>{o.cand_code}</Link>
          </div>
        </div>
        <div className="flex gap-2">
          <a href={`tel:${o.mobile}`}><Button variant="secondary" icon={Phone}>Call</Button></a>
          <Button variant="whatsapp" icon={MessageCircle} onClick={() => setMsg('selection')}>WhatsApp</Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Onboarding steps (planned from joining date)" className="lg:col-span-2"><StepTracker steps={data.steps} onAction={setTask} /></Card>
        <div className="space-y-5">
          <Card title="Joining details" actions={form && <Button size="sm" onClick={save}>Save</Button>}>
            <div className="space-y-3">
              <Field label="Joining date"><input type="date" className="input" value={f.joining_date} onChange={(e) => setForm({ ...f, joining_date: e.target.value })} /></Field>
              <Field label="Department"><input className="input" value={f.department} onChange={(e) => setForm({ ...f, department: e.target.value })} /></Field>
              <Field label="Buddy"><input className="input" value={f.buddy} onChange={(e) => setForm({ ...f, buddy: e.target.value })} /></Field>
              <div className="text-sm text-slate-600">Offered salary: <b>{o.offered_salary || '—'}</b> · Agency payment: <b>{inr(o.agency_payment)}</b></div>
            </div>
          </Card>
          <Card title={`Onboarding checklist (${doneCount}/${data.checklist_items.length})`}>
            <ul className="space-y-1.5">
              {data.checklist_items.map((i) => (
                <li key={i}><label className="flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-emerald-600" checked={!!o.checklist[i]} onChange={() => toggle(i)} /><span className={o.checklist[i] ? 'text-slate-400 line-through' : 'text-slate-700'}>{i}</span></label></li>
              ))}
            </ul>
          </Card>
          <Card title="Timeline" bodyClass="p-0">
            <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto text-sm">
              {data.activity.map((a) => <li key={a.id} className="px-4 py-2"><div>{a.action}</div><div className="text-xs text-slate-400">{a.user_name || 'System'} · {relTime(a.created_at)}{a.detail ? ` · ${a.detail}` : ''}</div></li>)}
            </ul>
          </Card>
        </div>
      </div>
      {task && <TaskModal task={{ ...task, title: o.name, record_code: o.code }} onClose={() => setTask(null)} onDone={reload} />}
      {msg && <MessageModal open candidate={{ id: o.candidate_id, name: o.name, mobile: o.mobile, email: o.email }} defaultTemplate={msg} onClose={() => setMsg(null)} />}
    </div>
  );
}
