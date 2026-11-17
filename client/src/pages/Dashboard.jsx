import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ClipboardList, Users, CalendarClock, AlertTriangle, UserCheck, PauseCircle, Timer, Briefcase } from 'lucide-react';
import { useApi, Card, Stat, Spinner, Tabs, Badge, Empty } from '../components/ui';
import { HBar, VBar, Lines } from '../components/charts';
import { auth, fmtDate, relTime } from '../api';

function range(key) {
  const d = new Date();
  const iso = (x) => x.toISOString().slice(0, 10);
  if (key === 'month') return `from=${iso(new Date(d.getFullYear(), d.getMonth(), 1))}`;
  if (key === '3m') return `from=${iso(new Date(d.getFullYear(), d.getMonth() - 2, 1))}`;
  if (key === 'year') return `from=${d.getFullYear()}-01-01`;
  return '';
}
const monthLabel = (m) => new Date(`${m}-01T00:00`).toLocaleString('en-IN', { month: 'short', year: '2-digit' });

export default function Dashboard() {
  const [period, setPeriod] = useState('year');
  const { data, loading } = useApi(`/dashboard?${range(period)}`, [period]);
  const tasks = useApi('/tasks?scope=mine&when=due');
  const activity = useApi('/activity');
  const nav = useNavigate();
  const user = auth.user;

  const monthly = useMemo(() => (data?.monthly || []).map((m) => ({ ...m, label: monthLabel(m.month) })), [data]);
  if (loading && !data) return <Spinner />;
  const k = data.kpis;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Namaste, {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-sm text-slate-500">Live view of hiring – from requirement to 90-day retention.</p>
        </div>
        <Tabs value={period} onChange={setPeriod} tabs={[{ value: 'month', label: 'This month' }, { value: '3m', label: '3 months' }, { value: 'year', label: 'This year' }, { value: 'all', label: 'All time' }]} />
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={ClipboardList} label="Open requirements" value={k.open_requirements} sub={`${k.open_positions} positions to fill`} onClick={() => nav('/requirements?status=Open')} />
        <Stat icon={Users} tone="sky" label="Candidates in pipeline" value={k.active_candidates} onClick={() => nav('/candidates?status=Active')} />
        <Stat icon={AlertTriangle} tone="red" label="Overdue steps (team)" value={k.overdue_tasks} sub={`${k.pending_tasks} due incl. today`} onClick={() => nav('/rescue')} />
        <Stat icon={CalendarClock} tone="amber" label="Interviews today" value={k.interviews_today} />
        <Stat icon={Briefcase} tone="violet" label="Candidates sourced" value={k.sourced_period} sub="in selected period" />
        <Stat icon={UserCheck} tone="green" label="Selected" value={k.selected_period} sub={`${k.joined_this_month} joined this month`} />
        <Stat icon={PauseCircle} tone="amber" label="Waiting for Ritesh Sir" value={k.on_hold_ritesh_sir} sub="hold decisions" onClick={() => nav('/tasks?stage=outward')} />
        <Stat icon={Timer} tone="sky" label="Avg. days to select" value={k.avg_time_to_hire_days} sub="sourced → final select" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Hiring funnel" className="lg:col-span-2">
          <HBar data={data.funnel} x="value" y="stage" name="Candidates" />
          <p className="mt-1 text-xs text-slate-400">Candidates sourced in the period and how far they reached.</p>
        </Card>
        <Card title="My tasks due" actions={<Link to="/tasks" className="link text-xs">Open all</Link>} bodyClass="p-0">
          {tasks.loading ? <Spinner /> : !tasks.data?.length ? <Empty text="All clear – nothing due 🎉" /> : (
            <ul className="max-h-[300px] divide-y divide-slate-100 overflow-y-auto">
              {tasks.data.slice(0, 12).map((t) => (
                <li key={t.id} className="px-4 py-2.5">
                  <Link to="/tasks" className="block">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-800">{t.title}</span>
                      {t.overdue_hours > 0 ? <Badge color="red">{t.overdue_hours > 48 ? `${Math.round(t.overdue_hours / 24)}d` : `${t.overdue_hours}h`} late</Badge> : <Badge color="amber">today</Badge>}
                    </div>
                    <div className="text-xs text-slate-500">{t.short_name} · {t.record_code}</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Candidates sourced per month"><VBar data={monthly} x="label" y="outward" name="Sourced" /></Card>
        <Card title="Selected vs joined per month"><Lines data={monthly} x="label" series={[{ key: 'selected', name: 'Selected' }, { key: 'joined', name: 'Joined' }]} /></Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Source performance" bodyClass="p-0" actions={<Link to="/reports" className="link text-xs">Full report</Link>}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Source</th><th className="th text-right">Sourced</th><th className="th text-right">Interviews</th><th className="th text-right">Selected</th><th className="th text-right">Conv. %</th></tr></thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source}><td className="td font-medium">{s.source}</td><td className="td text-right tabular-nums">{s.outward}</td><td className="td text-right tabular-nums">{s.interviews}</td><td className="td text-right tabular-nums">{s.selected}</td><td className="td text-right tabular-nums">{s.conversion}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Oldest open requirements" bodyClass="p-0" actions={<Link to="/requirements" className="link text-xs">All</Link>}>
          {!data.requirementsAging.length ? <Empty /> : (
            <table className="w-full">
              <thead><tr><th className="th">Req.</th><th className="th">Position</th><th className="th text-right">Age</th><th className="th text-right">Cands.</th></tr></thead>
              <tbody>
                {data.requirementsAging.slice(0, 8).map((r) => (
                  <tr key={r.code}><td className="td text-xs text-slate-500">{r.code}</td><td className="td"><div className="font-medium">{r.designation}</div><div className="text-xs text-slate-500">{r.company}</div></td>
                    <td className={`td text-right tabular-nums ${r.age_days > 30 ? 'font-semibold text-rose-600' : ''}`}>{r.age_days}d</td><td className="td text-right tabular-nums">{r.candidates}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card title="Recent activity" bodyClass="p-0">
        {!activity.data?.length ? <Empty /> : (
          <ul className="divide-y divide-slate-100">
            {activity.data.slice(0, 12).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="min-w-0 truncate"><span className="font-medium text-slate-800">{a.record}</span> – {a.action}{a.detail ? <span className="text-slate-400"> · {a.detail}</span> : null}</span>
                <span className="shrink-0 text-xs text-slate-400" title={fmtDate(a.created_at)}>{a.user_name || 'System'} · {relTime(a.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
