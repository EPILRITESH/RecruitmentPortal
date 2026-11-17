import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil, KeyRound, Plus } from 'lucide-react';
import { api, fmtDate, inr } from '../../api';
import { useApi, Spinner, Card, Button, Badge, StatusBadge, Modal, Field, Select, ErrorBox, toast } from '../../components/ui';
import { EmployeeForm } from './Employees';
import { MonthCalendar } from '../self/MyHR';

export default function EmployeeDetail() {
  const { id } = useParams();
  const { data, loading, reload, error } = useApi(`/hr/employees/${id}`, [id]);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const att = useApi(data ? `/hr/attendance?month=${month}&q=${encodeURIComponent(data.employee.emp_code)}` : null, [month, data?.employee.emp_code]);
  const [edit, setEdit] = useState(false);
  const [login, setLogin] = useState(null);
  const [adj, setAdj] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (loading && !data) return <Spinner />;
  const e = data.employee;
  const days = att.data?.employees.find((x) => x.id === e.id)?.days || {};

  const createLogin = async () => {
    const r = await api(`/hr/employees/${id}/login`, { method: 'POST', body: {} });
    setLogin(r); reload();
  };
  const saveAdj = async () => {
    await api(`/hr/employees/${id}/leave-adjust`, { method: 'POST', body: adj });
    toast('Leave balance adjusted'); setAdj(null); reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link to="/hr/employees" className="hover:underline">Employees</Link> / {e.emp_code}</div>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">{e.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <StatusBadge value={e.status === 'Active' ? 'Active' : e.status} /> {e.designation} · {e.department} · {e.company} · joined {fmtDate(e.joining_date, false)}
            {e.candidate_id && <Link className="link" to={`/candidates/${e.candidate_id}`}>recruitment record</Link>}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={KeyRound} onClick={createLogin}>{e.user_id ? 'Reset portal password' : 'Create portal login'}</Button>
          <Button icon={Pencil} onClick={() => setEdit(true)}>Edit</Button>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card title="Attendance" actions={<input type="month" className="input !w-40 !py-1" value={month} onChange={(x) => setMonth(x.target.value)} />}>
            <MonthCalendar month={month} rows={Object.values(days)} />
          </Card>
          <Card title="Leave requests" bodyClass="p-0">
            <table className="w-full"><thead><tr>{['Type', 'Dates', 'Days', 'Reason', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{data.leaves.map((l) => <tr key={l.id}><td className="td">{l.leave_code}</td><td className="td text-xs">{fmtDate(l.from_date, false)} – {fmtDate(l.to_date, false)}{l.half_day ? ' (½)' : ''}</td><td className="td">{l.days}</td><td className="td text-xs">{l.reason}</td><td className="td"><StatusBadge value={l.status} /></td></tr>)}</tbody></table>
          </Card>
        </div>
        <div className="space-y-5">
          <Card title="Leave balance (this year)" actions={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setAdj({ leave_code: 'CL', days: '', note: '' })}>Adjust</Button>}>
            <table className="w-full text-sm"><thead><tr><th className="th">Type</th><th className="th text-right">Entitled</th><th className="th text-right">Taken</th><th className="th text-right">Balance</th></tr></thead>
              <tbody>{data.balances.map((b) => <tr key={b.code}><td className="td">{b.name}</td><td className="td text-right">{b.entitled + b.adjusted}</td><td className="td text-right">{b.taken}{b.pending ? <span className="text-amber-600"> +{b.pending}</span> : ''}</td><td className="td text-right font-semibold">{b.balance}</td></tr>)}</tbody></table>
          </Card>
          <Card title="Salary slips" bodyClass="p-0">
            {!data.payslips.length ? <p className="p-4 text-sm text-slate-400">No payroll yet.</p> : (
              <ul className="divide-y divide-slate-100">{data.payslips.map((p) => <li key={p.id} className="flex items-center justify-between px-4 py-2 text-sm"><Link className="link" to={`/payslip/${p.id}`}>{p.month}</Link><span>{inr(Math.round(p.net))} {p.published ? <Badge color="green">sent</Badge> : <Badge>draft</Badge>}</span></li>)}</ul>
            )}
          </Card>
          <Card title="Details">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {[['Mobile', e.mobile], ['Email', e.email], ['Shift', e.shift_name], ['Biometric ID', e.biometric_id], ['Salary', `${inr(e.gross_salary)} / ${e.salary_type}`], ['PF / ESIC / PT', `${e.pf_applicable ? 'PF ' : ''}${e.esic_applicable ? 'ESIC ' : ''}${e.pt_applicable ? 'PT' : ''}` || '—'], ['Bank', e.bank_name], ['Account', e.account_no], ['IFSC', e.ifsc], ['PAN', e.pan], ['UAN', e.uan], ['Portal login', e.login || '—']].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-slate-400">{k}</dt><dd className="break-words text-slate-700">{v || '—'}</dd></div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
      {edit && <EmployeeForm initial={e} onClose={() => setEdit(false)} onSaved={reload} />}
      {login && (
        <Modal open onClose={() => setLogin(null)} title="Portal login ready">
          <p className="text-sm text-slate-600">Share this with {e.name}. They can mark leave, see attendance and download salary slips.</p>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 font-mono text-sm">Login: {login.login}<br />Password: {login.password}</div>
          <p className="mt-2 text-xs text-slate-400">They can sign in with their mobile number or {login.email}.</p>
        </Modal>
      )}
      {adj && (
        <Modal open onClose={() => setAdj(null)} title="Adjust leave balance" footer={<><Button variant="secondary" onClick={() => setAdj(null)}>Cancel</Button><Button onClick={saveAdj}>Save</Button></>}>
          <div className="grid gap-3">
            <Field label="Leave type"><Select value={adj.leave_code} onChange={(x) => setAdj({ ...adj, leave_code: x.target.value })} options={data.balances.map((b) => ({ value: b.code, label: b.name }))} /></Field>
            <Field label="Days (+ add / − deduct)" hint="Opening balance, carry forward, comp-off credit…"><input type="number" step="0.5" className="input" value={adj.days} onChange={(x) => setAdj({ ...adj, days: x.target.value })} /></Field>
            <Field label="Note"><input className="input" value={adj.note} onChange={(x) => setAdj({ ...adj, note: x.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
