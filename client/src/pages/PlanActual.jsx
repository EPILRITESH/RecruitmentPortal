import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmtDate } from '../api';
import { useApi, PageHeader, Tabs, Spinner, Empty, Select } from '../components/ui';
import { TaskModal } from '../components/workflow';
import { useMasters } from '../components/forms';

const LINK = { requirement: '/requirements/', candidate: '/candidates/', onboarding: '/onboarding/' };
const short = (s) => (s ? fmtDate(s).replace(/, \d\d:\d\d.*$/, '') : '');

function Cell({ c, onOpen }) {
  if (!c) return <td className="td border-l border-slate-100 text-center text-xs text-slate-300">—</td>;
  const late = c.state === 'pending' && new Date(c.planned_at.replace(' ', 'T')) < new Date();
  const tone = c.state === 'done' ? (c.delay_hours > 0 ? 'bg-amber-50' : 'bg-emerald-50') : c.state === 'pending' ? (late ? 'bg-rose-50' : 'bg-white') : 'bg-slate-50';
  return (
    <td className={`td border-l border-slate-100 text-[11px] leading-tight ${tone} ${c.state === 'pending' ? 'cursor-pointer hover:ring-2 hover:ring-inset hover:ring-indigo-300' : ''}`} onClick={() => c.state === 'pending' && onOpen(c)}>
      <div className="text-slate-500">P: {short(c.planned_at)}</div>
      <div className={c.actual_at ? 'text-slate-800' : 'text-slate-300'}>A: {c.actual_at ? short(c.actual_at) : '—'}</div>
      <div className={`font-medium ${c.state === 'done' ? (c.delay_hours > 0 ? 'text-amber-700' : 'text-emerald-700') : late ? 'text-rose-600' : c.state === 'pending' ? 'text-slate-500' : 'text-slate-400'}`}>
        {c.state === 'done' ? `${c.result}${c.delay_hours > 0 ? ` · ${c.delay_hours >= 24 ? `${Math.round(c.delay_hours / 24)}d` : `${Math.round(c.delay_hours)}h`} late` : ''}` : c.state === 'pending' ? (late ? 'Pending · late' : 'Pending') : c.state}
      </div>
    </td>
  );
}

export default function PlanActual() {
  const [stage, setStage] = useState('outward');
  const [status, setStatus] = useState('open');
  const [source, setSource] = useState('');
  const [company, setCompany] = useState('');
  const { names } = useMasters();
  const { data, loading, reload } = useApi(`/fms/${stage}?status=${status}&source=${encodeURIComponent(source)}&company=${encodeURIComponent(company)}`, [stage, status, source, company]);
  const [task, setTask] = useState(null);

  const open = (row, c) => {
    const s = data.steps.find((x) => x.code === c.step_code);
    setTask({ ...c, step_name: s.full, short_name: s.name, options: s.options, fields: s.fields, no: s.no, title: row.name, record_code: row.code, designation: row.designation, company: row.company });
  };

  return (
    <div>
      <PageHeader title="Plan vs Actual (FMS view)" subtitle="Same layout as the FMS-26 sheet: every step shows its Planned date (P), Actual date (A) and status. Click a pending cell to update it – the actual time is stamped and the next step is planned automatically." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={stage} onChange={setStage} tabs={[{ value: 'inward', label: 'Inward FMS' }, { value: 'outward', label: 'Outward FMS' }, { value: 'onboarding', label: 'Onboarding FMS' }]} />
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'open', label: 'Open only' }, { value: 'all', label: 'All (latest 200)' }]} />
        <div className="w-48"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
        {stage !== 'inward' && <div className="w-44"><Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="All platforms" options={names('source')} /></div>}
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-emerald-100" />done on time</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-amber-100" />done late</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded bg-rose-100" />pending & late</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded border border-slate-200 bg-white" />pending</span>
      </div>
      {loading && !data ? <Spinner /> : !data.rows.length ? <Empty /> : (
        <div className="card max-h-[70vh] overflow-auto">
          <table className="w-full border-separate border-spacing-0">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="th sticky left-0 z-20 min-w-[200px]">Record</th>
                {data.steps.map((s) => <th key={s.code} className="th min-w-[118px] border-l border-slate-200 text-center normal-case">Step {s.no}<div className="font-normal text-slate-500">{s.name}</div></th>)}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td className="td sticky left-0 z-[5] bg-white">
                    <Link className="link" to={LINK[data.entity_type] + row.id}>{row.code}</Link>
                    <div className="text-sm font-medium text-slate-800">{row.name}</div>
                    <div className="text-[11px] text-slate-500">{[row.designation !== row.name ? row.designation : null, row.source, row.status].filter(Boolean).join(' · ')}</div>
                  </td>
                  {data.steps.map((s) => <Cell key={s.code} c={row.cells[s.code]} onOpen={(c) => open(row, c)} />)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {task && <TaskModal task={task} onClose={() => setTask(null)} onDone={reload} />}
    </div>
  );
}
