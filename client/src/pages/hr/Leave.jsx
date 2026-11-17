import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Plus } from 'lucide-react';
import { api, auth, fmtDate } from '../../api';
import { useApi, PageHeader, Tabs, Spinner, Empty, Button, StatusBadge, Modal, Field, Select, ErrorBox, toast } from '../../components/ui';

function Approvals({ onChange }) {
  const { data, reload } = useApi('/leave-approvals');
  const [remark, setRemark] = useState({});
  const decide = async (l, approve) => {
    try {
      await api(`/leaves/${l.id}/decide`, { method: 'POST', body: { approve, remark: remark[l.id] || '' } });
      toast(`${l.name}: leave ${approve ? 'approved' : 'rejected'} – employee informed`); reload(); onChange?.();
    } catch (e) { toast(e.message, 'error'); }
  };
  if (!data) return <Spinner />;
  if (!data.length) return <Empty text="No leave waiting for approval 🎉" />;
  return (
    <div className="space-y-2">{data.map((l) => (
      <div key={l.id} className="card flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-slate-800">{l.name} <span className="text-xs font-normal text-slate-400">{l.emp_code} · {l.department}</span></div>
          <div className="text-sm text-slate-600"><b>{l.leave_name || l.leave_code}</b> · {fmtDate(l.from_date, false)} – {fmtDate(l.to_date, false)} · {l.days} day{l.half_day ? ` (${l.half_day} half)` : ''}</div>
          {l.reason && <div className="text-xs text-slate-500">“{l.reason}”</div>}
        </div>
        <input className="input sm:w-56" placeholder="Remark (optional)" value={remark[l.id] || ''} onChange={(e) => setRemark({ ...remark, [l.id]: e.target.value })} />
        <div className="flex gap-1.5"><Button size="sm" variant="success" icon={CheckCircle2} onClick={() => decide(l, true)}>Approve</Button><Button size="sm" variant="secondary" icon={XCircle} className="!text-rose-600" onClick={() => decide(l, false)}>Reject</Button></div>
      </div>))}
    </div>
  );
}

function AllRequests() {
  const [status, setStatus] = useState('all');
  const { data, reload } = useApi(`/hr/leaves?status=${status}`, [status]);
  const cancel = async (id) => { if (window.confirm('Cancel this leave?')) { await api(`/leaves/${id}/cancel`, { method: 'POST' }); reload(); } };
  return (
    <div>
      <div className="mb-3"><Tabs value={status} onChange={setStatus} tabs={['all', 'Pending', 'Approved', 'Rejected', 'Cancelled'].map((s) => ({ value: s, label: s === 'all' ? 'All' : s }))} /></div>
      {!data ? <Spinner /> : !data.length ? <Empty /> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr>{['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', 'Decided by', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{data.map((l) => <tr key={l.id}><td className="td"><Link className="link" to={`/hr/employees/${l.employee_id}`}>{l.name}</Link><div className="text-xs text-slate-400">{l.emp_code}</div></td><td className="td text-sm">{l.leave_name || l.leave_code}</td>
            <td className="td whitespace-nowrap text-xs">{fmtDate(l.from_date, false)} – {fmtDate(l.to_date, false)}</td><td className="td">{l.days}</td><td className="td text-xs">{l.reason}</td><td className="td"><StatusBadge value={l.status} /></td>
            <td className="td text-xs">{l.decided_by_name}{l.decision_remark ? ` – ${l.decision_remark}` : ''}</td><td className="td">{['Pending', 'Approved'].includes(l.status) && <button className="text-xs text-rose-600 hover:underline" onClick={() => cancel(l.id)}>Cancel</button>}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

function ApplyFor({ onClose }) {
  const emps = useApi('/hr/employees?status=Active');
  const st = useApi('/hr/settings');
  const [f, setF] = useState({ employee_id: '', leave_code: 'CL', from_date: '', to_date: '', half_day: '', reason: '' });
  const [err, setErr] = useState(null);
  const save = async () => {
    setErr(null);
    try { await api('/hr/leaves', { method: 'POST', body: f }); toast('Leave added (pending approval)'); onClose(); } catch (e) { setErr(e.message); }
  };
  return (
    <Modal open onClose={onClose} title="Add leave for an employee" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Employee" className="sm:col-span-2"><Select value={f.employee_id} onChange={(e) => setF({ ...f, employee_id: e.target.value })} placeholder="Select" options={(emps.data || []).map((e) => ({ value: e.id, label: `${e.emp_code} – ${e.name}` }))} /></Field>
        <Field label="Type"><Select value={f.leave_code} onChange={(e) => setF({ ...f, leave_code: e.target.value })} options={(st.data?.leave_types || []).filter((t) => t.active).map((t) => ({ value: t.code, label: t.name }))} /></Field>
        <Field label="Half day"><Select value={f.half_day} onChange={(e) => setF({ ...f, half_day: e.target.value })} placeholder="Full day" options={[{ value: 'first', label: 'First half' }, { value: 'second', label: 'Second half' }]} /></Field>
        <Field label="From"><input type="date" className="input" value={f.from_date} onChange={(e) => setF({ ...f, from_date: e.target.value, to_date: f.to_date || e.target.value })} /></Field>
        <Field label="To"><input type="date" className="input" value={f.to_date} onChange={(e) => setF({ ...f, to_date: e.target.value })} /></Field>
        <Field label="Reason" className="sm:col-span-2"><input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      </div>
      <div className="mt-2"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export default function Leave() {
  const isHR = ['admin', 'hr'].includes(auth.user?.role);
  const [tab, setTab] = useState('approvals');
  const [add, setAdd] = useState(false);
  return (
    <div>
      <PageHeader title="Leave" subtitle="Employees apply from their own login (My attendance & leave). HR, admin or the reporting manager approves here – the employee gets WhatsApp / email and attendance is updated automatically."
        actions={isHR && <Button icon={Plus} onClick={() => setAdd(true)}>Add leave for employee</Button>} />
      {isHR && <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'approvals', label: 'Waiting for approval' }, { value: 'all', label: 'All requests' }]} /></div>}
      {tab === 'approvals' ? <Approvals /> : <AllRequests />}
      {add && <ApplyFor onClose={() => setAdd(false)} />}
    </div>
  );
}
