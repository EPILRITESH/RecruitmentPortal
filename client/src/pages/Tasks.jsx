import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageCircle, Phone, Search } from 'lucide-react';
import { api, auth, fmtDate } from '../api';
import { useApi, Tabs, Spinner, Empty, Badge, Button, PageHeader, Select, toast } from '../components/ui';
import { TaskModal } from '../components/workflow';
import MessageModal from '../components/MessageModal';

const STAGE_LABEL = { inward: 'Inward', outward: 'Outward', onboarding: 'Onboarding' };
const STAGE_COLOR = { inward: 'indigo', outward: 'blue', onboarding: 'green' };
const recordLink = (t) => (t.entity_type === 'requirement' ? `/requirements/${t.entity_id}` : t.entity_type === 'candidate' ? `/candidates/${t.entity_id}` : `/onboarding/${t.entity_id}`);

export function TaskList({ tasks, reload, showDoer }) {
  const [active, setActive] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(null);

  const quick = async (t, o) => {
    if (t.fields?.length || o.outcome === 'replan') return setActive(t);
    setBusy(`${t.id}-${o.value}`);
    try {
      await api(`/tasks/${t.id}/complete`, { method: 'POST', body: { result: o.value } });
      toast(`${t.record_code}: ${t.short_name} → ${o.value}`);
      reload();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };

  if (!tasks.length) return <Empty text="No tasks here 🎉" />;
  return (
    <>
      <div className="space-y-2">
        {tasks.map((t) => {
          const late = t.overdue_hours > 0;
          return (
            <div key={t.id} className={`card flex flex-col gap-3 p-3 sm:flex-row sm:items-center ${late ? 'border-l-4 border-l-rose-400' : 'border-l-4 border-l-amber-300'}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={STAGE_COLOR[t.stage]}>Step {t.no} · {STAGE_LABEL[t.stage]}</Badge>
                  <span className="text-sm font-semibold text-slate-800">{t.step_name}</span>
                  {late ? <Badge color="red">{t.overdue_hours >= 48 ? `${Math.round(t.overdue_hours / 24)} days` : `${t.overdue_hours} hrs`} overdue</Badge> : <Badge color="amber">due {fmtDate(t.planned_at)}</Badge>}
                  {t.follow_ups > 0 && <Badge>{t.follow_ups} follow-ups</Badge>}
                </div>
                <div className="mt-1 text-sm">
                  <Link to={recordLink(t)} className="link">{t.record_code}</Link>
                  <span className="text-slate-700"> · {t.title}</span>
                  {t.entity_type !== 'requirement' && t.designation && <span className="text-slate-500"> · {t.designation}, {t.company}</span>}
                  {t.source && <span className="text-slate-400"> · {t.source}</span>}
                </div>
                {showDoer && <div className="text-xs text-slate-400">Doer: {t.doer_name || t.doer_role}</div>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {t.mobile && (
                  <>
                    <a href={`tel:${t.mobile}`} className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" title="Call"><Phone className="h-4 w-4" /></a>
                    <button onClick={() => setMsg(t)} className="rounded-lg border border-slate-200 p-2 text-[#1ebe5b] hover:bg-slate-50" title="WhatsApp"><MessageCircle className="h-4 w-4" /></button>
                  </>
                )}
                {t.options.map((o) => (
                  <Button key={o.value} size="sm" loading={busy === `${t.id}-${o.value}`}
                    variant={o.color === 'green' ? 'success' : o.color === 'red' ? 'secondary' : 'secondary'}
                    className={o.color === 'red' ? '!text-rose-600' : ''} onClick={() => quick(t, o)}>{o.label}</Button>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setActive(t)}>More…</Button>
              </div>
            </div>
          );
        })}
      </div>
      {active && <TaskModal task={active} onClose={() => setActive(null)} onDone={reload} />}
      {msg && <MessageModal open candidate={{ id: msg.candidate_id, name: msg.title, mobile: msg.mobile }} onClose={() => setMsg(null)}
        defaultTemplate={msg.step_code === 'S05' ? 'interest' : msg.step_code === 'S06' ? 'apply_form' : msg.step_code === 'S07' ? 'interview' : msg.step_code === 'S20' ? 'feedback' : ''} />}
    </>
  );
}

export default function Tasks() {
  const [params] = useSearchParams();
  const [when, setWhen] = useState('due');
  const [scope, setScope] = useState('mine');
  const [stage, setStage] = useState(params.get('stage') || '');
  const [q, setQ] = useState('');
  const { data, loading, reload } = useApi(`/tasks?scope=${scope}&when=${when}&stage=${stage}&q=${encodeURIComponent(q)}`, [when, scope, stage, q]);
  const summary = useApi('/tasks/summary', [data]);
  const s = summary.data || {};

  return (
    <div>
      <PageHeader title="My Tasks" subtitle="Every waiting step lands here automatically – click a result and the next step is created with its planned date. No more Studio links or Rescue Sheet." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={when} onChange={setWhen} tabs={[
          { value: 'due', label: 'Due today', count: (s.overdue || 0) + (s.today || 0) },
          { value: 'overdue', label: 'Overdue', count: s.overdue, danger: true },
          { value: 'upcoming', label: 'Upcoming', count: s.upcoming },
          { value: 'all', label: 'All open' },
        ]} />
        {auth.user?.role !== 'admin' && <Tabs value={scope} onChange={setScope} tabs={[{ value: 'mine', label: 'Mine' }, { value: 'all', label: 'Whole team' }]} />}
        <div className="w-40"><Select value={stage} onChange={(e) => setStage(e.target.value)} placeholder="All stages" options={[{ value: 'inward', label: 'Inward' }, { value: 'outward', label: 'Outward' }, { value: 'onboarding', label: 'Onboarding' }]} /></div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, ID, mobile…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {loading && !data ? <Spinner /> : <TaskList tasks={data || []} reload={() => { reload(); summary.reload(); }} showDoer={scope === 'all' || auth.user?.role === 'admin'} />}
    </div>
  );
}
