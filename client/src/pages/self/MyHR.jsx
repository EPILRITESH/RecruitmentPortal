import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, Clock4, FileText } from 'lucide-react';
import { api, fmtDate, inr } from '../../api';
import { useApi, Spinner, Card, Button, StatusBadge, Modal, Field, Select, ErrorBox, toast, PageHeader, Empty } from '../../components/ui';

const COLORS = { P: 'bg-emerald-100 text-emerald-800', HD: 'bg-amber-100 text-amber-800', A: 'bg-rose-100 text-rose-700', MP: 'bg-rose-100 text-rose-700', L: 'bg-sky-100 text-sky-800', WO: 'bg-slate-100 text-slate-500', H: 'bg-violet-100 text-violet-700', WOP: 'bg-emerald-100 text-emerald-800', HP: 'bg-emerald-100 text-emerald-800', NA: 'bg-slate-50 text-slate-300' };
const hm = (s) => (s ? s.slice(11, 16) : '');

/** Month calendar of attendance rows [{date, status, first_in, last_out, work_minutes, late_minutes, ot_minutes, leave_code}] */
export function MonthCalendar({ month, rows }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday first
  const by = Object.fromEntries((rows || []).map((r) => [r.date, r]));
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  const count = (k) => (rows || []).filter((r) => r.status === k).length;
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {[['P', 'Present'], ['HD', 'Half day'], ['A', 'Absent'], ['MP', 'Missed punch'], ['L', 'Leave'], ['WO', 'Week off'], ['H', 'Holiday']].map(([k, l]) => <span key={k} className={`rounded px-1.5 py-0.5 ${COLORS[k]}`}>{l}: {count(k) + (k === 'P' ? count('WOP') + count('HP') : 0)}</span>)}
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">Late: {(rows || []).filter((r) => r.late_minutes > 0).length}</span>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">OT: {Math.round((rows || []).reduce((s, r) => s + (r.ot_minutes || 0), 0) / 6) / 10} h</span>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px]">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="font-semibold text-slate-400">{d}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const r = by[d];
          return (
            <div key={d} title={r ? `${r.status}${r.remark ? ` – ${r.remark}` : ''}` : ''} className={`min-h-[58px] rounded-md p-1 ${r ? COLORS[r.status] || 'bg-slate-50' : 'bg-slate-50 text-slate-300'}`}>
              <div className="flex justify-between"><span className="font-semibold">{Number(d.slice(8))}</span><span>{r?.status}{r?.leave_code ? `·${r.leave_code}` : ''}</span></div>
              {r?.first_in && <div>{hm(r.first_in)}–{hm(r.last_out) || '?'}</div>}
              {r?.late_minutes > 0 && <div className="text-rose-600">late {r.late_minutes}m</div>}
              {r?.ot_minutes > 0 && <div className="text-emerald-700">OT {Math.round(r.ot_minutes / 6) / 10}h</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function MyHR() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, loading, reload } = useApi(`/me/hr?month=${month}`, [month]);
  const [leave, setLeave] = useState(null);
  const [corr, setCorr] = useState(null);
  const [err, setErr] = useState(null);
  if (loading && !data) return <Spinner />;
  if (!data.employee) return <div><PageHeader title="My attendance & leave" /><Empty text="Your login is not linked to an employee record yet. Ask HR to link it (Employees → Create portal login)." /></div>;
  const e = data.employee;

  const apply = async () => {
    setErr(null);
    try { await api('/me/leave', { method: 'POST', body: leave }); toast('Leave request sent to HR'); setLeave(null); reload(); } catch (x) { setErr(x.message); }
  };
  const correct = async () => {
    setErr(null);
    try { await api('/me/attendance-request', { method: 'POST', body: corr }); toast('Correction request sent'); setCorr(null); reload(); } catch (x) { setErr(x.message); }
  };
  const cancel = async (id) => { if (!window.confirm('Cancel this leave request?')) return; await api(`/leaves/${id}/cancel`, { method: 'POST' }); reload(); };

  return (
    <div className="space-y-5">
      <PageHeader title={`Hi ${e.name.split(' ')[0]} 👋`} subtitle={`${e.emp_code} · ${e.designation || ''} · ${e.department || ''} · Shift ${e.shift_name || ''} ${e.start_time ? `(${e.start_time}–${e.end_time})` : ''}`}
        actions={<>
          <Button variant="secondary" icon={Clock4} onClick={() => setCorr({ date: '', in_time: '', out_time: '', reason: '' })}>Attendance correction</Button>
          <Button icon={CalendarPlus} onClick={() => setLeave({ leave_code: data.leave_types[0]?.code, from_date: '', to_date: '', half_day: '', reason: '' })}>Apply leave</Button>
        </>} />
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {data.balances.filter((b) => b.paid || b.taken).map((b) => (
          <div key={b.code} className="card p-3"><div className="text-xs text-slate-500">{b.name}</div><div className="text-2xl font-semibold">{b.balance}</div><div className="text-xs text-slate-400">taken {b.taken}{b.pending ? ` · ${b.pending} pending` : ''}</div></div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="My attendance" className="lg:col-span-2" actions={<input type="month" className="input !w-40 !py-1" value={month} onChange={(x) => setMonth(x.target.value)} />}>
          <MonthCalendar month={month} rows={data.attendance} />
        </Card>
        <div className="space-y-5">
          <Card title="My leave requests" bodyClass="p-0">
            {!data.leaves.length ? <p className="p-4 text-sm text-slate-400">No leave requests.</p> : (
              <ul className="divide-y divide-slate-100">{data.leaves.map((l) => (
                <li key={l.id} className="px-4 py-2 text-sm">
                  <div className="flex items-center justify-between"><b>{l.leave_name || l.leave_code}</b><StatusBadge value={l.status} /></div>
                  <div className="text-xs text-slate-500">{fmtDate(l.from_date, false)} – {fmtDate(l.to_date, false)} · {l.days} day{l.half_day ? ` (${l.half_day} half)` : ''}</div>
                  {l.decision_remark && <div className="text-xs text-slate-500">HR: {l.decision_remark}</div>}
                  {(l.status === 'Pending' || (l.status === 'Approved' && l.from_date > new Date().toISOString().slice(0, 10))) && <button className="text-xs text-rose-600 hover:underline" onClick={() => cancel(l.id)}>Cancel</button>}
                </li>))}
              </ul>
            )}
          </Card>
          <Card title="My salary slips" bodyClass="p-0">
            {!data.payslips.length ? <p className="p-4 text-sm text-slate-400">No salary slips yet.</p> : (
              <ul className="divide-y divide-slate-100">{data.payslips.map((p) => <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm"><Link className="link flex items-center gap-1" to={`/payslip/${p.id}`}><FileText className="h-4 w-4" />{p.month}</Link><span>{inr(Math.round(p.net))}</span></li>)}</ul>
            )}
          </Card>
          {data.requests.length > 0 && <Card title="Correction requests" bodyClass="p-0">
            <ul className="divide-y divide-slate-100">{data.requests.map((q) => <li key={q.id} className="flex justify-between px-4 py-2 text-xs"><span>{fmtDate(q.date, false)} {q.in_time || ''}–{q.out_time || ''}</span><StatusBadge value={q.status} /></li>)}</ul>
          </Card>}
          {data.holidays.length > 0 && <Card title="Upcoming holidays" bodyClass="p-0"><ul className="divide-y divide-slate-100">{data.holidays.map((h) => <li key={h.date} className="flex justify-between px-4 py-2 text-sm"><span>{h.name}</span><span className="text-xs text-slate-500">{fmtDate(h.date, false)}</span></li>)}</ul></Card>}
        </div>
      </div>

      {leave && (
        <Modal open onClose={() => setLeave(null)} title="Apply for leave" footer={<><Button variant="secondary" onClick={() => setLeave(null)}>Cancel</Button><Button onClick={apply} disabled={!leave.from_date}>Send to HR</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Leave type" className="sm:col-span-2"><Select value={leave.leave_code} onChange={(x) => setLeave({ ...leave, leave_code: x.target.value })} options={data.balances.map((b) => ({ value: b.code, label: `${b.name} – balance ${b.balance}` }))} /></Field>
            <Field label="From"><input type="date" className="input" value={leave.from_date} onChange={(x) => setLeave({ ...leave, from_date: x.target.value, to_date: leave.to_date || x.target.value })} /></Field>
            <Field label="To"><input type="date" className="input" value={leave.to_date} onChange={(x) => setLeave({ ...leave, to_date: x.target.value })} /></Field>
            {leave.from_date && leave.from_date === leave.to_date && <Field label="Half day?"><Select value={leave.half_day} onChange={(x) => setLeave({ ...leave, half_day: x.target.value })} placeholder="Full day" options={[{ value: 'first', label: 'First half' }, { value: 'second', label: 'Second half' }]} /></Field>}
            <Field label="Reason" className="sm:col-span-2"><textarea className="input" rows={2} value={leave.reason} onChange={(x) => setLeave({ ...leave, reason: x.target.value })} /></Field>
          </div>
          <p className="mt-2 text-xs text-slate-500">Weekly offs and holidays inside the dates are not counted. HR gets an email / WhatsApp and you are informed when it is approved.</p>
          <div className="mt-2"><ErrorBox error={err} /></div>
        </Modal>
      )}
      {corr && (
        <Modal open onClose={() => setCorr(null)} title="Attendance correction (missed punch)" footer={<><Button variant="secondary" onClick={() => setCorr(null)}>Cancel</Button><Button onClick={correct} disabled={!corr.date}>Send to HR</Button></>}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date"><input type="date" className="input" value={corr.date} onChange={(x) => setCorr({ ...corr, date: x.target.value })} /></Field>
            <Field label="In time"><input type="time" className="input" value={corr.in_time} onChange={(x) => setCorr({ ...corr, in_time: x.target.value })} /></Field>
            <Field label="Out time"><input type="time" className="input" value={corr.out_time} onChange={(x) => setCorr({ ...corr, out_time: x.target.value })} /></Field>
            <Field label="Reason" className="sm:col-span-3"><input className="input" value={corr.reason} onChange={(x) => setCorr({ ...corr, reason: x.target.value })} placeholder="Forgot to punch out / machine not working…" /></Field>
          </div>
          <div className="mt-2"><ErrorBox error={err} /></div>
        </Modal>
      )}
    </div>
  );
}

