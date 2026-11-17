import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calculator, Lock, Unlock, Send, Download, Plus, Trash2, CheckCircle2 } from 'lucide-react';
import { api, auth, inr } from '../../api';
import { useApi, PageHeader, Spinner, Empty, Button, Badge, Card, Modal, Field, Select, ErrorBox, toast, Stat } from '../../components/ui';
import { useMasters } from '../../components/forms';

const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); };

export default function Payroll() {
  const [month, setMonth] = useState(lastMonth());
  const [company, setCompany] = useState('');
  const { names } = useMasters();
  const { data, loading, reload } = useApi(`/hr/payroll?month=${month}&company=${encodeURIComponent(company)}`, [month, company]);
  const emps = useApi('/hr/employees?status=');
  const [busy, setBusy] = useState('');
  const [adj, setAdj] = useState(null);
  const [err, setErr] = useState(null);
  const run = data?.run;
  const monthDone = `${month}-31` < new Date().toISOString().slice(0, 10) || new Date(`${month}-01`) < new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  const generate = async () => {
    setErr(null);
    try {
      let offset = 0;
      for (;;) {
        const r = await api('/hr/payroll/generate', { method: 'POST', body: { month, company: company || null, offset } });
        setBusy(`${r.done}/${r.total}`);
        if (r.next == null) break;
        offset = r.next;
      }
      toast('Salary calculated'); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const status = async (s) => {
    setErr(null);
    try { await api(`/hr/payroll/${run.id}/status`, { method: 'POST', body: { status: s } }); toast(`Payroll ${s}`); reload(); } catch (e) { setErr(e.message); }
  };
  const publish = async () => {
    setErr(null);
    try {
      for (;;) { const r = await api(`/hr/payroll/${run.id}/publish`, { method: 'POST' }); setBusy(`${r.left} left`); if (!r.left) break; }
      toast('Salary slips published – employees informed by WhatsApp / email'); reload();
    } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  const saveAdj = async () => {
    setErr(null);
    try { await api('/hr/salary-adjustments', { method: 'POST', body: { ...adj, month } }); toast('Added – click Calculate again'); setAdj(null); reload(); } catch (e) { setErr(e.message); }
  };
  const delAdj = async (id) => { await api(`/hr/salary-adjustments/${id}`, { method: 'DELETE' }); reload(); };
  const exportUrl = (kind) => `/api/hr/payroll/${run.id}/export?kind=${kind}&token=${auth.token}`;

  return (
    <div className="space-y-5">
      <PageHeader title="Payroll" subtitle="Attendance → paid days → earnings, overtime, PF / ESIC / PT and adjustments → salary slip. Rules are in HR Settings."
        actions={<>
          <input type="month" className="input !w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
          <div className="w-48"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
        </>} />
      <ErrorBox error={err} />
      {loading && !data ? <Spinner /> : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            {(!run || run.status === 'Draft') && <Button icon={Calculator} onClick={generate} loading={!!busy && !run?.status?.match(/Locked|Paid/)}>{busy ? `Calculating ${busy}` : run ? 'Re-calculate' : 'Calculate salary'}</Button>}
            {run?.status === 'Draft' && <Button variant="secondary" icon={Lock} onClick={() => status('Locked')}>Lock</Button>}
            {run && run.status !== 'Draft' && <>
              <Button icon={Send} onClick={publish} loading={!!busy}>{busy || 'Publish slips & notify'}</Button>
              {run.status === 'Locked' && <Button variant="success" icon={CheckCircle2} onClick={() => status('Paid')}>Mark paid</Button>}
              {auth.user?.role === 'admin' && <Button variant="ghost" icon={Unlock} onClick={() => status('Draft')}>Unlock</Button>}
            </>}
            {run && <><a href={exportUrl('register')}><Button variant="secondary" icon={Download}>Salary register</Button></a><a href={exportUrl('bank')}><Button variant="secondary" icon={Download}>Bank transfer sheet</Button></a></>}
            {run && <Badge color={run.status === 'Paid' ? 'green' : run.status === 'Locked' ? 'blue' : 'amber'} className="ml-auto">{run.status}</Badge>}
          </div>
          {!monthDone && <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">{month} is not finished – remaining days are counted as normal paid days (projected). Run final payroll after the month ends.</div>}

          {run && <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Employees" value={run.employees} />
            <Stat tone="sky" label="Gross earnings" value={inr(Math.round(run.gross))} />
            <Stat tone="red" label="Deductions" value={inr(Math.round(run.deductions))} />
            <Stat tone="green" label="Net pay" value={inr(Math.round(run.net))} />
          </div>}

          {!data.slips.length ? <Empty text="Click “Calculate salary” to build this month’s payroll from attendance" /> : (
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead><tr>{['Code', 'Employee', 'Present', 'Absent', 'Leave', 'LOP', 'Late', 'OT h', 'Paid days', 'Gross', 'Deductions', 'Net pay', ''].map((h, i) => <th key={h} className={`th ${i > 1 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{data.slips.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="td text-xs">{s.emp_code}</td>
                    <td className="td"><Link className="link" to={`/hr/employees/${s.employee_id}`}>{s.name}</Link><div className="text-xs text-slate-400">{s.department}</div></td>
                    <td className="td text-right">{s.summary.present + s.summary.half * 0.5}</td><td className="td text-right text-rose-600">{s.summary.absent}</td><td className="td text-right">{s.summary.paid_leave}</td>
                    <td className="td text-right">{s.summary.lop}</td><td className="td text-right">{s.summary.late}</td><td className="td text-right">{s.summary.ot_hours}</td>
                    <td className="td text-right font-medium">{s.paid_days}</td><td className="td text-right">{inr(Math.round(s.gross))}</td><td className="td text-right text-rose-600">{inr(Math.round(s.deductions))}</td>
                    <td className="td text-right font-semibold">{inr(Math.round(s.net))}</td>
                    <td className="td whitespace-nowrap text-right"><Link className="link text-xs" to={`/payslip/${s.id}`}>Slip</Link>{s.published ? <Badge color="green" className="ml-1">sent</Badge> : null}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          )}

          <Card title={`Adjustments for ${month} (bonus, incentive, advance, loan, fine, TDS…)`} bodyClass="p-0" actions={(!run || run.status === 'Draft') && <Button size="sm" icon={Plus} onClick={() => setAdj({ employee_id: '', kind: 'advance', amount: '', note: '' })}>Add</Button>}>
            {!data.adjustments.length ? <p className="p-4 text-sm text-slate-400">None. Add before calculating the salary.</p> : (
              <table className="w-full"><thead><tr>{['Employee', 'Type', 'Amount', 'Note', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{data.adjustments.map((a) => <tr key={a.id}><td className="td">{a.emp_code} – {a.name}</td><td className="td text-sm">{data.kinds[a.kind]}</td><td className="td">{inr(a.amount)}</td><td className="td text-xs">{a.note}</td>
                  <td className="td">{(!run || run.status === 'Draft') && <button onClick={() => delAdj(a.id)} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>}</td></tr>)}</tbody></table>
            )}
          </Card>
        </>
      )}
      {adj && (
        <Modal open onClose={() => setAdj(null)} title="Salary adjustment" footer={<><Button variant="secondary" onClick={() => setAdj(null)}>Cancel</Button><Button onClick={saveAdj}>Add</Button></>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Employee" className="sm:col-span-2"><Select value={adj.employee_id} onChange={(e) => setAdj({ ...adj, employee_id: e.target.value })} placeholder="Select" options={(emps.data || []).map((e) => ({ value: e.id, label: `${e.emp_code} – ${e.name}` }))} /></Field>
            <Field label="Type"><Select value={adj.kind} onChange={(e) => setAdj({ ...adj, kind: e.target.value })} options={Object.entries(data.kinds).map(([v, l]) => ({ value: v, label: l }))} /></Field>
            <Field label="Amount (₹)"><input type="number" className="input" value={adj.amount} onChange={(e) => setAdj({ ...adj, amount: e.target.value })} /></Field>
            <Field label="Note" className="sm:col-span-2"><input className="input" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
