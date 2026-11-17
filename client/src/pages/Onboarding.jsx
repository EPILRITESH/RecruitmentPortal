import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Download } from 'lucide-react';
import { exportUrl, fmtDate, inr } from '../api';
import { useApi, Spinner, Empty, PageHeader, StatusBadge, Tabs, Button, Badge } from '../components/ui';

export default function Onboarding() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const { data, loading } = useApi(`/onboardings?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`, [status, q]);

  return (
    <div>
      <PageHeader title="Onboarding" subtitle="Selected candidates – pre-onboarding, Day 1, documents, training, 6-day follow-up and 30 / 60 / 90-day retention checks. All dates are planned from the joining date."
        actions={<a href={exportUrl('onboardings')}><Button variant="secondary" icon={Download}>Export</Button></a>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: '', label: 'All' }, ...['Pre-Onboarding', 'Joined', 'Retained 90', 'Left', 'Not Joined'].map((s) => ({ value: s, label: s }))]} />
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search name or ONB-no…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      {loading && !data ? <Spinner /> : !data.length ? <Empty /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">ID</th><th className="th">Joinee</th><th className="th">Position</th><th className="th">Joining</th><th className="th">Progress</th><th className="th">Next step</th><th className="th text-right">Agency ₹</th><th className="th">Status</th></tr></thead>
            <tbody>
              {data.map((o) => {
                const pct = o.total_steps ? Math.round((o.done_steps / o.total_steps) * 100) : 0;
                const late = o.next_due && new Date(o.next_due.replace(' ', 'T')) < new Date();
                return (
                  <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/onboarding/${o.id}`)}>
                    <td className="td"><Link className="link" to={`/onboarding/${o.id}`}>{o.code}</Link></td>
                    <td className="td"><div className="font-medium">{o.name}</div><div className="text-xs text-slate-500">{o.source}</div></td>
                    <td className="td"><div className="text-sm">{o.designation}</div><div className="text-xs text-slate-500">{o.company}</div></td>
                    <td className="td whitespace-nowrap text-sm">{fmtDate(o.joining_date, false)}</td>
                    <td className="td w-36">
                      <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} /></div>
                      <div className="mt-1 text-xs text-slate-500">{o.done_steps}/{o.total_steps} steps</div>
                    </td>
                    <td className="td text-xs">{o.next_step ? <><div>{o.next_step}</div><div className={late ? 'font-semibold text-rose-600' : 'text-slate-400'}>{fmtDate(o.next_due)}</div></> : '—'}</td>
                    <td className="td text-right tabular-nums">{o.agency_payment ? inr(o.agency_payment) : '—'}</td>
                    <td className="td"><StatusBadge value={o.status} />{late && <Badge color="red" className="ml-1">late</Badge>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
