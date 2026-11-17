import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download } from 'lucide-react';
import { exportUrl, fmtDate } from '../api';
import { useApi, Spinner, Empty, Button, PageHeader, Select, StatusBadge, Badge, Tabs } from '../components/ui';
import { RequirementForm, useMasters } from '../components/forms';

export default function Requirements() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') || 'Open');
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const { names } = useMasters();
  const nav = useNavigate();
  const { data, loading, reload } = useApi(`/requirements?status=${status}&company=${encodeURIComponent(company)}&q=${encodeURIComponent(q)}`, [status, company, q]);

  return (
    <div>
      <PageHeader title="Inward – Requirements" subtitle="Vacancies raised by HODs. Each one runs Step 1 (JD) → Step 2 (Post) → Step 3 (PC verification)."
        actions={<>
          <a href={exportUrl('requirements')}><Button variant="secondary" icon={Download}>Export</Button></a>
          <Button icon={Plus} onClick={() => setOpen(true)}>New requirement</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'Open', label: 'Open' }, { value: 'On Hold', label: 'On hold' }, { value: 'Closed', label: 'Closed' }, { value: '', label: 'All' }]} />
        <div className="w-52"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search designation, IN-no, requested by…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {loading && !data ? <Spinner /> : !data.length ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr>
              <th className="th">ID</th><th className="th">Position</th><th className="th">Requested by</th><th className="th">Salary</th>
              <th className="th">Pending step</th><th className="th text-right">Candidates</th><th className="th text-right">Filled</th><th className="th text-right">Age</th><th className="th">Status</th>
            </tr></thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/requirements/${r.id}`)}>
                  <td className="td"><Link to={`/requirements/${r.id}`} className="link">{r.code}</Link><div className="text-xs text-slate-400">{fmtDate(r.request_date, false)}</div></td>
                  <td className="td"><div className="font-medium text-slate-800">{r.designation}</div><div className="text-xs text-slate-500">{r.company}</div></td>
                  <td className="td text-sm">{r.requirement_by}</td>
                  <td className="td whitespace-nowrap text-sm">{r.salary_range || '—'}</td>
                  <td className="td">{r.pending_step ? <Badge color="amber">{r.pending_step}</Badge> : <span className="text-xs text-slate-400">sourcing</span>}</td>
                  <td className="td text-right tabular-nums">{r.total_candidates}<span className="text-xs text-slate-400"> ({r.active_candidates} active)</span></td>
                  <td className="td text-right tabular-nums">{r.filled}/{r.openings}</td>
                  <td className={`td text-right tabular-nums ${r.status === 'Open' && r.age_days > 30 ? 'font-semibold text-rose-600' : ''}`}>{r.age_days}d</td>
                  <td className="td"><div className="flex flex-col gap-1"><StatusBadge value={r.status} />{r.priority !== 'Normal' && <StatusBadge value={r.priority} />}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && <RequirementForm open onClose={() => setOpen(false)} onSaved={(r) => { reload(); if (r?.id) nav(`/requirements/${r.id}`); }} />}
    </div>
  );
}
