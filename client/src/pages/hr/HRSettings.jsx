import { useEffect, useState } from 'react';
import { Plus, Save } from 'lucide-react';
import { api, auth } from '../../api';
import { useApi, PageHeader, Spinner, Tabs, Card, Button, Field, Select, Modal, Badge, toast } from '../../components/ui';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Shifts() {
  const { data, reload } = useApi('/hr/shifts');
  const [f, setF] = useState(null);
  if (!data) return <Spinner />;
  const save = async () => { await api('/hr/shifts', { method: 'POST', body: f }); toast('Shift saved – re-process attendance to apply'); setF(null); reload(); };
  const offs = (s) => String(s.weekly_off ?? '').split(',').filter((x) => x !== '').map(Number);
  const I = (k, label, type = 'number', props = {}) => <Field label={label}><input className="input" type={type} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} /></Field>;
  return (
    <Card title="Shifts" bodyClass="p-0" actions={<Button size="sm" icon={Plus} onClick={() => setF({ name: '', start_time: '09:00', end_time: '18:00', break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10, full_day_hours: 8, half_day_hours: 4, ot_after_minutes: 30, ot_round_minutes: 30, weekly_off: '0', active: 1 })}>Add shift</Button>}>
      <table className="w-full"><thead><tr>{['Shift', 'Timing', 'Break', 'Late after', 'Full / half day', 'OT after', 'Weekly off', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{data.map((s) => <tr key={s.id} className={s.active ? '' : 'opacity-50'}><td className="td font-medium">{s.name}</td><td className="td">{s.start_time} – {s.end_time}</td><td className="td">{s.break_minutes}m</td><td className="td">{s.grace_minutes}m</td><td className="td">{s.full_day_hours}h / {s.half_day_hours}h</td><td className="td">{s.ot_after_minutes}m (round {s.ot_round_minutes}m)</td><td className="td">{offs(s).map((d) => DAYS[d]).join(', ') || 'none'}</td>
          <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setF({ ...s })}>Edit</Button></td></tr>)}</tbody></table>
      {f && <Modal open wide onClose={() => setF(null)} title={f.id ? `Shift – ${f.name}` : 'New shift'} footer={<><Button variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-4">
          {I('name', 'Name', 'text', { className: 'input' })}{I('start_time', 'Start', 'time')}{I('end_time', 'End (night shift: next morning)', 'time')}{I('break_minutes', 'Break (min)')}
          {I('grace_minutes', 'Late after (min grace)')}{I('early_grace_minutes', 'Early-go grace (min)')}{I('full_day_hours', 'Full day if worked ≥ (h)', 'number', { step: 0.5 })}{I('half_day_hours', 'Half day if worked ≥ (h)', 'number', { step: 0.5 })}
          {I('ot_after_minutes', 'OT starts after shift end + (min)')}{I('ot_round_minutes', 'OT rounded down to (min)')}
          <Field label="Weekly off" className="sm:col-span-2"><div className="flex flex-wrap gap-2 pt-1">{DAYS.map((d, i) => <label key={d} className="flex items-center gap-1 text-sm"><input type="checkbox" checked={offs(f).includes(i)} onChange={(e) => setF({ ...f, weekly_off: (e.target.checked ? [...offs(f), i] : offs(f).filter((x) => x !== i)).sort().join(',') })} />{d}</label>)}</div></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>
        </div>
      </Modal>}
    </Card>
  );
}

function Rules() {
  const { data } = useApi('/hr/settings');
  const [f, setF] = useState(null);
  useEffect(() => { if (data) setF(data.settings); }, [data]);
  if (!f) return <Spinner />;
  const admin = auth.user?.role === 'admin';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => { await api('/hr/settings', { method: 'PUT', body: f }); toast('Rules saved – re-calculate attendance / payroll to apply'); };
  const I = (k, label, hint) => <Field label={label} hint={hint}><input className="input" value={f[k] ?? ''} onChange={set(k)} disabled={!admin} /></Field>;
  const S = (k, label, options, hint) => <Field label={label} hint={hint}><Select value={f[k]} onChange={set(k)} options={options} disabled={!admin} /></Field>;
  const yes = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
  return (
    <div className="space-y-5">
      {!admin && <p className="text-sm text-amber-700">Only admin can change these rules.</p>}
      <Card title="Attendance rules" actions={admin && <Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-4">
          {S('single_punch', 'Only one punch in a day', [{ value: 'MP', label: 'Missed punch (unpaid until corrected)' }, { value: 'HD', label: 'Half day' }])}
          {I('late_penalty_count', 'Late marks for ½ day cut', '0 = no penalty. 3 = every 3 lates cuts half a day')}
          {S('sandwich_leave', 'Sandwich rule', yes, 'Week-off between two absences becomes unpaid')}
          {S('ot_on_off_day', 'Work on week-off / holiday', [{ value: '1', label: 'All hours = overtime' }, { value: '0', label: 'Only a paid day' }])}
        </div>
      </Card>
      <Card title="Salary rules" actions={admin && <Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-4">
          {S('pay_days_basis', 'Per-day salary =', [{ value: 'calendar', label: 'Gross ÷ days in month' }, { value: '30', label: 'Gross ÷ 30' }, { value: '26', label: 'Gross ÷ 26 (week-offs unpaid)' }])}
          {S('weekly_off_paid', 'Weekly off paid', yes)}{S('holiday_paid', 'Holidays paid', yes)}
          {I('basic_pct', 'Basic + DA (% of gross)')}{I('hra_pct', 'HRA (% of basic)', 'Rest of gross = Special allowance')}
          {S('ot_basis', 'OT calculated on', [{ value: 'gross', label: 'Gross salary' }, { value: 'basic', label: 'Basic only' }])}
          {I('ot_multiplier', 'OT rate × normal hourly', '2 = double (Factories Act), 1 = single, 1.5…')}{I('ot_max_hours_month', 'Max OT hours / month', '0 = no limit')}
          {I('pf_rate', 'PF employee %')}{I('pf_employer_rate', 'PF employer %')}{I('pf_ceiling', 'PF wage ceiling ₹', '15000 as per EPFO; 0 = on full basic')}
          {I('esic_rate', 'ESIC employee %')}{I('esic_employer_rate', 'ESIC employer %')}{I('esic_limit', 'ESIC applies if gross ≤ ₹')}
          {I('pt_slabs', 'Professional tax slabs', 'from:amount, e.g. 0:0,12000:200 (Gujarat)')}{I('emp_code_prefix', 'Employee code prefix')}
        </div>
      </Card>
    </div>
  );
}

function LeaveTypes() {
  const { data, reload } = useApi('/hr/settings');
  const [f, setF] = useState(null);
  if (!data) return <Spinner />;
  const save = async () => { await api('/hr/leave-types', { method: 'POST', body: f }); toast('Leave type saved'); setF(null); reload(); };
  return (
    <Card title="Leave types & yearly quota" bodyClass="p-0" actions={auth.user?.role === 'admin' && <Button size="sm" icon={Plus} onClick={() => setF({ code: '', name: '', paid: 1, annual_quota: 0, accrual: 'yearly', carry_forward_max: 0, allow_half_day: 1, allow_negative: 0, active: 1 })}>Add type</Button>}>
      <table className="w-full"><thead><tr>{['Code', 'Name', 'Paid', 'Days / year', 'Credit', 'Carry fwd max', 'Half day', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody>{data.leave_types.map((t) => <tr key={t.code} className={t.active ? '' : 'opacity-50'}><td className="td font-semibold">{t.code}</td><td className="td">{t.name}</td><td className="td">{t.paid ? <Badge color="green">paid</Badge> : <Badge color="red">unpaid</Badge>}</td><td className="td">{t.annual_quota}</td><td className="td text-sm">{t.accrual === 'monthly' ? 'monthly' : 'at year start'}</td><td className="td">{t.carry_forward_max}</td><td className="td">{t.allow_half_day ? 'yes' : 'no'}</td>
          <td className="td text-right">{auth.user?.role === 'admin' && <Button size="sm" variant="ghost" onClick={() => setF({ ...t })}>Edit</Button>}</td></tr>)}</tbody></table>
      <p className="px-4 py-2 text-xs text-slate-500">Quota is pro-rated for people who join during the year. Opening balance / carry forward / comp-off credit: Employee → Leave balance → Adjust.</p>
      {f && <Modal open onClose={() => setF(null)} title="Leave type" footer={<><Button variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Days per year"><input type="number" step="0.5" className="input" value={f.annual_quota} onChange={(e) => setF({ ...f, annual_quota: e.target.value })} /></Field>
          <Field label="Credit"><Select value={f.accrual} onChange={(e) => setF({ ...f, accrual: e.target.value })} options={[{ value: 'yearly', label: 'Full at year start' }, { value: 'monthly', label: 'Monthly (1/12 each month)' }]} /></Field>
          <Field label="Carry forward max"><input type="number" className="input" value={f.carry_forward_max} onChange={(e) => setF({ ...f, carry_forward_max: e.target.value })} /></Field>
          <div className="space-y-2 pt-6 text-sm">
            {[['paid', 'Paid leave'], ['allow_half_day', 'Half day allowed'], ['allow_negative', 'Allow without balance'], ['active', 'Active']].map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked ? 1 : 0 })} />{l}</label>)}
          </div>
        </div>
      </Modal>}
    </Card>
  );
}

export default function HRSettings() {
  const [tab, setTab] = useState('shifts');
  return (
    <div>
      <PageHeader title="HR settings" subtitle="Shifts, attendance & salary rules, leave policy. Holidays are in Settings → Holidays (shared with recruitment)." />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'shifts', label: 'Shifts' }, { value: 'rules', label: 'Attendance & salary rules' }, { value: 'leave', label: 'Leave types' }]} /></div>
      {tab === 'shifts' && <Shifts />}
      {tab === 'rules' && <Rules />}
      {tab === 'leave' && <LeaveTypes />}
    </div>
  );
}
