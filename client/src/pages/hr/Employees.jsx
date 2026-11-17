import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileSpreadsheet, Users, UserPlus, UserMinus, CalendarCheck, Fingerprint } from 'lucide-react';
import { api, auth, fmtDate } from '../../api';
import { useApi, PageHeader, Button, Spinner, Empty, Tabs, Select, Stat, Badge, Modal, Field, ErrorBox, toast, Card } from '../../components/ui';
import { useMasters } from '../../components/forms';
import SheetImport from '../../components/SheetImport';

export const ATT_COLOR = { P: 'green', HD: 'amber', A: 'red', MP: 'red', L: 'blue', WO: 'slate', H: 'purple', WOP: 'green', HP: 'green', NA: 'slate' };
export const ATT_LABEL = { P: 'Present', HD: 'Half day', A: 'Absent', MP: 'Missed punch', L: 'Leave', WO: 'Weekly off', H: 'Holiday', WOP: 'Worked on off', HP: 'Worked on holiday', NA: 'Not employed' };

const EMP_IMPORT_FIELDS = [
  ['emp_code', 'Emp code', ['emp code', 'employee code', 'emp id', 'employee id', 'code', 'emp no']],
  ['name', 'Name', ['name', 'employee name', 'full name'], true],
  ['mobile', 'Mobile', ['mobile', 'mobile no', 'phone', 'contact']],
  ['email', 'Email', ['email', 'email id']],
  ['company', 'Company', ['company', 'unit', 'branch']],
  ['department', 'Department', ['department', 'dept']],
  ['designation', 'Designation', ['designation', 'post']],
  ['joining_date', 'Joining date', ['joining date', 'doj', 'date of joining'], false, 'date'],
  ['biometric_id', 'Biometric / card no', ['biometric id', 'card no', 'device id', 'enroll no', 'enrollment no', 'user id', 'punch code']],
  ['gross_salary', 'Gross salary / rate', ['gross', 'gross salary', 'salary', 'monthly salary', 'ctc', 'rate']],
  ['salary_type', 'Salary type', ['salary type', 'wage type']],
  ['bank_name', 'Bank', ['bank', 'bank name']],
  ['account_no', 'Account no', ['account no', 'account number', 'a/c no']],
  ['ifsc', 'IFSC', ['ifsc', 'ifsc code']],
  ['pan', 'PAN', ['pan', 'pan no']],
  ['uan', 'UAN', ['uan', 'uan no', 'pf no']],
  ['esic_no', 'ESIC no', ['esic', 'esic no', 'ip no']],
].map(([key, label, aliases, required, kind]) => ({ key, label, aliases, required, kind }));

export function EmployeeForm({ initial, onClose, onSaved }) {
  const { names } = useMasters();
  const shifts = useApi('/hr/shifts');
  const users = useApi('/users');
  const [f, setF] = useState({ salary_type: 'monthly', ot_allowed: 1, pt_applicable: 1, pf_applicable: 0, esic_applicable: 0, status: 'Active', employment_type: 'Permanent', ...initial });
  const [tab, setTab] = useState('job');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      if (f.id) await api(`/hr/employees/${f.id}`, { method: 'PUT', body: f }); else await api('/hr/employees', { method: 'POST', body: f });
      toast('Employee saved'); onSaved?.(); onClose();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const I = (k, label, type = 'text', props = {}) => <Field label={label}><input className="input" type={type} value={f[k] ?? ''} onChange={set(k)} {...props} /></Field>;
  const C = (k, label) => <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={!!f[k]} onChange={set(k)} />{label}</label>;
  return (
    <Modal open wide onClose={onClose} title={f.id ? `Edit – ${f.name}` : 'Add employee'} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="mb-4"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'job', label: 'Personal & job' }, { value: 'att', label: 'Attendance' }, { value: 'pay', label: 'Salary & statutory' }, { value: 'bank', label: 'Bank & IDs' }]} /></div>
      {tab === 'job' && <div className="grid gap-3 sm:grid-cols-3">
        {I('emp_code', 'Employee code', 'text', { placeholder: 'auto if blank' })}{I('name', 'Full name *')}{I('mobile', 'Mobile')}
        {I('email', 'Email')}<Field label="Gender"><Select value={f.gender || ''} onChange={set('gender')} placeholder="—" options={['Male', 'Female', 'Other']} /></Field>{I('dob', 'Date of birth', 'date')}
        <Field label="Company"><Select value={f.company || ''} onChange={set('company')} placeholder="—" options={names('company')} /></Field>
        <Field label="Department"><Select value={f.department || ''} onChange={set('department')} placeholder="—" options={names('department')} /></Field>
        {I('designation', 'Designation')}{I('location', 'Location')}{I('joining_date', 'Joining date', 'date')}
        <Field label="Employment type"><Select value={f.employment_type || ''} onChange={set('employment_type')} options={['Permanent', 'Probation', 'Contract', 'Trainee']} /></Field>
        <Field label="Status"><Select value={f.status} onChange={set('status')} options={['Active', 'On Notice', 'Left']} /></Field>
        {I('exit_date', 'Exit date', 'date')}
        <Field label="Reporting manager (can approve leave)"><Select value={f.manager_user_id || ''} onChange={set('manager_user_id')} placeholder="— HR approves —" options={(users.data?.users || []).filter((u) => u.role !== 'employee').map((u) => ({ value: u.id, label: u.name }))} /></Field>
        <Field label="Address" className="sm:col-span-3"><input className="input" value={f.address || ''} onChange={set('address')} /></Field>
      </div>}
      {tab === 'att' && <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Shift"><Select value={f.shift_id || ''} onChange={set('shift_id')} placeholder="Default" options={(shifts.data || []).map((s) => ({ value: s.id, label: `${s.name} (${s.start_time}–${s.end_time})` }))} /></Field>
        {I('biometric_id', 'Biometric / device user ID', 'text', { placeholder: 'Enroll no. on the machine' })}
        <div className="flex items-end pb-2">{C('ot_allowed', 'Overtime allowed')}</div>
        <p className="text-xs text-slate-500 sm:col-span-3">The biometric ID must match the user / enroll number saved on the attendance machine. Punches from unknown IDs are shown on the Attendance page so you can link them.</p>
      </div>}
      {tab === 'pay' && <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Salary type"><Select value={f.salary_type} onChange={set('salary_type')} options={[{ value: 'monthly', label: 'Monthly (fixed gross)' }, { value: 'daily', label: 'Daily wage' }, { value: 'hourly', label: 'Hourly' }]} /></Field>
        {I('gross_salary', f.salary_type === 'daily' ? 'Rate per day (₹)' : f.salary_type === 'hourly' ? 'Rate per hour (₹)' : 'Monthly gross (₹)', 'number')}
        <div />
        <div className="space-y-2 pt-2">{C('pf_applicable', 'PF applicable')}{C('esic_applicable', 'ESIC applicable')}{C('pt_applicable', 'Professional tax')}</div>
        <p className="text-xs text-slate-500 sm:col-span-2">Basic / HRA split, PF / ESIC rates, PT slabs, OT rate and paid-day rules are set once in HR Settings and apply to everyone.</p>
      </div>}
      {tab === 'bank' && <div className="grid gap-3 sm:grid-cols-3">
        {I('bank_name', 'Bank name')}{I('account_no', 'Account number')}{I('ifsc', 'IFSC')}{I('pan', 'PAN')}{I('aadhaar', 'Aadhaar')}{I('uan', 'UAN (PF)')}{I('esic_no', 'ESIC IP number')}
      </div>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export default function Employees() {
  const [status, setStatus] = useState('Active');
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState(null);
  const [imp, setImp] = useState(false);
  const { names } = useMasters();
  const nav = useNavigate();
  const { data, loading, reload } = useApi(`/hr/employees?status=${status}&company=${encodeURIComponent(company)}&q=${encodeURIComponent(q)}`, [status, company, q]);
  const sum = useApi('/hr/summary', [data]);
  const s = sum.data;
  const today = (k) => s?.today.find((x) => x.status === k)?.n || 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Employees" subtitle="Everyone on the payroll. New joinees from recruitment are added automatically when Step 15 is marked Joined."
        actions={<>
          <Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImp(true)}>Import Excel</Button>
          <Button icon={Plus} onClick={() => setEdit({})}>Add employee</Button>
        </>} />
      {s && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat icon={Users} label="Active employees" value={s.total} />
          <Stat icon={CalendarCheck} tone="green" label="Present today" value={today('P') + today('HD') + today('WOP') + today('HP')} sub={`${today('A')} absent · ${s.late} late`} onClick={() => nav('/hr/attendance')} />
          <Stat icon={UserPlus} tone="sky" label="Joined this month" value={s.joined} />
          <Stat icon={UserMinus} tone="red" label="Left this month" value={s.left} />
          <Stat icon={Fingerprint} tone="amber" label="Leave / corrections pending" value={s.pendingLeaves + s.pendingReq} onClick={() => nav('/hr/leave')} />
        </div>
      )}
      {s && s.head.length > 0 && (
        <Card title="Headcount by company & department" bodyClass="p-3">
          <div className="flex flex-wrap gap-2">{s.head.map((h, i) => <Badge key={i} color="indigo">{h.company || '—'} · {h.department || '—'}: <b className="ml-1">{h.n}</b></Badge>)}</div>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: 'Active', label: 'Active' }, { value: 'On Notice', label: 'On notice' }, { value: 'Left', label: 'Left' }, { value: '', label: 'All' }]} />
        <div className="w-52"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
        <div className="relative min-w-[200px] flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" placeholder="Search name, code, mobile, biometric ID…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      </div>
      {loading && !data ? <Spinner /> : !data.length ? <Empty text="No employees yet – add them or import from Excel" /> : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead><tr>{['Code', 'Name', 'Company / dept', 'Designation', 'Joined', 'Shift', 'Bio ID', 'Salary', 'Today', 'Login'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/hr/employees/${e.id}`)}>
                <td className="td"><Link className="link" to={`/hr/employees/${e.id}`}>{e.emp_code}</Link></td>
                <td className="td"><div className="font-medium">{e.name}</div><div className="text-xs text-slate-500">{e.mobile}</div></td>
                <td className="td text-xs">{e.company}<div className="text-slate-500">{e.department}</div></td>
                <td className="td text-sm">{e.designation}</td>
                <td className="td whitespace-nowrap text-xs">{fmtDate(e.joining_date, false)}</td>
                <td className="td text-xs">{e.shift_name}</td>
                <td className="td text-xs">{e.biometric_id || <span className="text-rose-500">missing</span>}</td>
                <td className="td whitespace-nowrap text-sm">₹{Number(e.gross_salary).toLocaleString('en-IN')}<span className="text-xs text-slate-400">/{e.salary_type === 'monthly' ? 'mo' : e.salary_type === 'daily' ? 'day' : 'hr'}</span></td>
                <td className="td">{e.today ? <Badge color={ATT_COLOR[e.today]}>{e.today}</Badge> : <span className="text-xs text-slate-300">–</span>}</td>
                <td className="td text-xs">{e.login ? <Badge color="green">yes</Badge> : '—'}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      )}
      {edit && <EmployeeForm initial={edit} onClose={() => setEdit(null)} onSaved={reload} />}
      {imp && <SheetImport open title="Import employees" endpoint="/hr/employees/import" fields={EMP_IMPORT_FIELDS} onClose={() => setImp(false)} onDone={reload}
        help="Upload your employee master (Excel / CSV). Rows with an existing employee code are updated, new codes are added. Salary type can be monthly / daily / hourly." />}
      {auth.user?.role === 'admin' && null}
    </div>
  );
}
