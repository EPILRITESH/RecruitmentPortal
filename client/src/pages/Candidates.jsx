import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Download, LayoutList, Columns3, FileSpreadsheet, Upload } from 'lucide-react';
import { exportUrl, fmtDate } from '../api';
import { useApi, Spinner, Empty, Button, PageHeader, Select, StatusBadge, Tabs, Badge } from '../components/ui';
import { CandidateForm, useMasters } from '../components/forms';
import { ImportModal, ResumeBulkModal, BulkBar } from '../components/BulkTools';

function scoreColor(s) { return s == null ? 'slate' : s >= 70 ? 'green' : s >= 45 ? 'amber' : 'red'; }

function Pipeline({ rows, steps }) {
  const cols = steps.filter((s) => s.stage === 'outward');
  return (
    <div className="flex gap-3 overflow-x-auto pb-3">
      {cols.map((s) => {
        const items = rows.filter((c) => c.current_step === s.code);
        return (
          <div key={s.code} className="w-64 shrink-0 rounded-xl bg-slate-100 p-2">
            <div className="flex items-center justify-between px-1 pb-2 text-xs font-semibold text-slate-600">
              <span>Step {s.no} · {s.short_name}</span><span className="rounded-full bg-white px-1.5">{items.length}</span>
            </div>
            <div className="space-y-2">
              {items.slice(0, 50).map((c) => {
                const late = c.next_due && new Date(c.next_due.replace(' ', 'T')) < new Date();
                return (
                  <Link key={c.id} to={`/candidates/${c.id}`} className={`block rounded-lg border bg-white p-2.5 text-sm shadow-sm hover:border-indigo-300 ${late ? 'border-rose-200' : 'border-slate-200'}`}>
                    <div className="flex items-center justify-between gap-1"><span className="truncate font-medium text-slate-800">{c.name}</span>{c.ai_score != null && <Badge color={scoreColor(c.ai_score)}>{c.ai_score}</Badge>}</div>
                    <div className="truncate text-xs text-slate-500">{c.designation || 'General pool'}</div>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-slate-400"><span>{c.source}</span>{late ? <span className="text-rose-500">overdue</span> : <span>{fmtDate(c.next_due)}</span>}</div>
                  </Link>
                );
              })}
              {!items.length && <div className="px-1 py-4 text-center text-xs text-slate-400">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Candidates() {
  const [params] = useSearchParams();
  const [view, setView] = useState('list');
  const [status, setStatus] = useState(params.get('status') || 'Active');
  const [source, setSource] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const [picked, setPicked] = useState([]);
  const { names } = useMasters();
  const steps = useApi('/steps');
  const nav = useNavigate();
  const { data, loading, reload } = useApi(`/candidates?status=${status}&source=${encodeURIComponent(source)}&q=${encodeURIComponent(q)}`, [status, source, q]);
  const rows = useMemo(() => data || [], [data]);

  return (
    <div>
      <PageHeader title="Outward – Candidates" subtitle="Every candidate from every source, with their current step. Duplicate mobiles are flagged automatically."
        actions={<>
          <a href={exportUrl('candidates')}><Button variant="secondary" icon={Download}>Export</Button></a>
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setModal('import')}>Import Excel</Button>
          <Button variant="secondary" icon={Upload} onClick={() => setModal('resumes')}>Upload resumes</Button>
          <Button icon={Plus} onClick={() => setOpen(true)}>Add candidate</Button>
        </>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} tabs={['Active', 'Selected', 'Joined', 'Future Hold', 'Rejected', 'Dropped', 'Left'].map((s) => ({ value: s, label: s })).concat([{ value: '', label: 'All' }])} />
        <div className="w-44"><Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="All sources" options={names('source')} /></div>
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input className="input pl-9" placeholder="Search name, mobile, OUT-no…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white p-0.5">
          <button onClick={() => setView('list')} className={`rounded-md p-1.5 ${view === 'list' ? 'bg-slate-100' : ''}`} title="List"><LayoutList className="h-4 w-4" /></button>
          <button onClick={() => { setView('board'); setStatus('Active'); }} className={`rounded-md p-1.5 ${view === 'board' ? 'bg-slate-100' : ''}`} title="Pipeline board"><Columns3 className="h-4 w-4" /></button>
        </div>
      </div>
      {view === 'list' && <BulkBar ids={picked} onClear={() => setPicked([])} onDone={() => { setPicked([]); reload(); }} />}
      {loading && !data ? <Spinner /> : !rows.length ? <Empty /> : view === 'board' ? <Pipeline rows={rows} steps={steps.data || []} /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th w-8"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={picked.length > 0 && picked.length === rows.length} onChange={(e) => setPicked(e.target.checked ? rows.map((c) => c.id) : [])} /></th><th className="th">ID</th><th className="th">Candidate</th><th className="th">Position</th><th className="th">Source</th><th className="th">Current step</th><th className="th">Next due</th><th className="th text-right">AI score</th><th className="th">Status</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const late = c.next_due && new Date(c.next_due.replace(' ', 'T')) < new Date();
                return (
                  <tr key={c.id} className={`cursor-pointer hover:bg-slate-50 ${picked.includes(c.id) ? 'bg-indigo-50/40' : ''}`} onClick={() => nav(`/candidates/${c.id}`)}>
                    <td className="td" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={picked.includes(c.id)} onChange={() => setPicked((x) => (x.includes(c.id) ? x.filter((i) => i !== c.id) : [...x, c.id]))} /></td>
                    <td className="td"><Link className="link" to={`/candidates/${c.id}`}>{c.code}</Link><div className="text-xs text-slate-400">{fmtDate(c.created_at, false)}</div></td>
                    <td className="td"><div className="font-medium text-slate-800">{c.name}</div><div className="text-xs text-slate-500">{c.mobile}</div></td>
                    <td className="td"><div className="text-sm">{c.designation || '—'}</div><div className="text-xs text-slate-500">{c.company} {c.req_code && `· ${c.req_code}`}</div></td>
                    <td className="td text-xs">{c.source}</td>
                    <td className="td text-sm">{c.stage}</td>
                    <td className={`td whitespace-nowrap text-xs ${late ? 'font-semibold text-rose-600' : ''}`}>{c.next_due ? fmtDate(c.next_due) : '—'}</td>
                    <td className="td text-right">{c.ai_score != null ? <Badge color={scoreColor(c.ai_score)}>{c.ai_score}</Badge> : '—'}</td>
                    <td className="td"><StatusBadge value={c.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length >= 500 && <div className="p-3 text-center text-xs text-slate-400">Showing latest 500 – use search or filters.</div>}
        </div>
      )}
      {modal === 'import' && <ImportModal open onClose={() => setModal(null)} onDone={reload} />}
      {modal === 'resumes' && <ResumeBulkModal open onClose={() => setModal(null)} onDone={reload} />}
      {open && <CandidateForm open onClose={() => setOpen(false)} onSaved={(r) => { reload(); if (r?.id) nav(`/candidates/${r.id}`); }} />}
    </div>
  );
}
