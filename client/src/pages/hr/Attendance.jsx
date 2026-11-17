import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, FileSpreadsheet, Fingerprint, Search, Copy, CheckCircle2, XCircle, Download } from 'lucide-react';
import { api, fmtDate } from '../../api';
import { useApi, PageHeader, Tabs, Spinner, Empty, Button, Badge, Card, Modal, Field, Select, ErrorBox, toast } from '../../components/ui';
import { useMasters } from '../../components/forms';
import SheetImport from '../../components/SheetImport';
import { ATT_LABEL } from './Employees';

const CELL = { P: 'bg-emerald-100 text-emerald-800', HD: 'bg-amber-100 text-amber-800', A: 'bg-rose-100 text-rose-700', MP: 'bg-rose-200 text-rose-800', L: 'bg-sky-100 text-sky-800',
  WO: 'bg-slate-100 text-slate-400', H: 'bg-violet-100 text-violet-700', WOP: 'bg-emerald-200 text-emerald-900', HP: 'bg-emerald-200 text-emerald-900', NA: 'bg-white text-slate-200' };
const hm = (s) => (s ? s.slice(11, 16) : '');
const STATUS_OPTIONS = Object.entries(ATT_LABEL).map(([v, l]) => ({ value: v, label: `${v} – ${l}` }));

const PUNCH_FIELDS = [
  { key: 'emp_code', label: 'Emp code / biometric ID', aliases: ['emp code', 'employee code', 'emp id', 'user id', 'enroll no', 'biometric id', 'card no', 'ac-no.', 'ac-no', 'pin', 'id'], required: true },
  { key: 'time', label: 'Punch date-time', aliases: ['time', 'date time', 'datetime', 'punch time', 'log time', 'checktime', 'check time'], kind: 'datetime' },
  { key: 'date', label: 'Date (daily sheet)', aliases: ['date', 'att date', 'attendance date'], kind: 'date' },
  { key: 'in', label: 'In time', aliases: ['in', 'in time', 'intime', 'first in', 'check in'], kind: 'time' },
  { key: 'out', label: 'Out time', aliases: ['out', 'out time', 'outtime', 'last out', 'check out'], kind: 'time' },
];

function Register({ month, company, q }) {
  const { data, loading, reload } = useApi(`/hr/attendance?month=${month}&company=${encodeURIComponent(company)}&q=${encodeURIComponent(q)}`, [month, company, q]);
  const [busy, setBusy] = useState('');
  const [cell, setCell] = useState(null);
  const process = async () => {
    let offset = 0;
    for (;;) {
      setBusy(`${offset}…`);
      const r = await api('/hr/attendance/process', { method: 'POST', body: { month, company: company || null, offset } });
      setBusy(`${r.done}/${r.total}`);
      if (r.next == null) break;
      offset = r.next;
    }
    setBusy(''); toast('Attendance re-calculated from punches'); reload();
  };
  const save = async () => {
    await api(`/hr/attendance/${cell.employee_id}/${cell.date}`, { method: 'PUT', body: cell });
    toast('Day updated'); setCell(null); reload();
  };
  const reset = async () => {
    await api(`/hr/attendance/${cell.employee_id}/${cell.date}`, { method: 'PUT', body: { reset: true } });
    toast('Back to machine data'); setCell(null); reload();
  };
  const totals = (days) => {
    const v = Object.values(days);
    const n = (k) => v.filter((d) => d.status === k).length;
    return { P: n('P') + n('WOP') + n('HP') + n('HD') * 0.5, A: n('A') + n('MP'), L: n('L'), late: v.filter((d) => d.late_minutes > 0).length, ot: Math.round(v.reduce((s, d) => s + (d.ot_minutes || 0), 0) / 6) / 10 };
  };
  const download = () => {
    const head = ['Code', 'Name', ...data.days.map((d) => d.slice(8)), 'Present', 'Absent', 'Leave', 'Late', 'OT h'];
    const lines = [head, ...data.employees.map((e) => { const t = totals(e.days); return [e.emp_code, e.name, ...data.days.map((d) => e.days[d]?.status || ''), t.P, t.A, t.L, t.late, t.ot]; })];
    const blob = new Blob(['﻿' + lines.map((l) => l.join(',')).join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `attendance-${month}.csv`; a.click();
  };
  if (loading && !data) return <Spinner />;
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button icon={RefreshCw} loading={!!busy} onClick={process}>{busy ? `Processing ${busy}` : 'Re-process from punches'}</Button>
        <Button variant="secondary" icon={Download} onClick={download}>Download register</Button>
        <div className="flex flex-wrap gap-1 text-[11px]">{Object.entries(ATT_LABEL).map(([k, l]) => <span key={k} className={`rounded px-1.5 py-0.5 ${CELL[k]}`}>{k} {l}</span>)}</div>
      </div>
      {!data.employees.length ? <Empty text="No employees" /> : (
        <div className="card max-h-[70vh] overflow-auto">
          <table className="border-separate border-spacing-0 text-[11px]">
            <thead className="sticky top-0 z-10"><tr>
              <th className="th sticky left-0 z-20 min-w-[170px]">Employee</th>
              {data.days.map((d) => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th key={d} className={`th !px-1 text-center ${dow === 0 ? '!bg-slate-200' : ''}`}>{Number(d.slice(8))}<div className="font-normal">{'SMTWTFS'[dow]}</div></th>; })}
              {['P', 'A', 'L', 'Late', 'OT h'].map((h) => <th key={h} className="th !px-1.5 text-center">{h}</th>)}
            </tr></thead>
            <tbody>{data.employees.map((e) => {
              const t = totals(e.days);
              return (
                <tr key={e.id}>
                  <td className="td sticky left-0 z-[5] bg-white !py-1"><Link className="link" to={`/hr/employees/${e.id}`}>{e.name}</Link><div className="text-slate-400">{e.emp_code} · {e.department}</div></td>
                  {data.days.map((d) => {
                    const a = e.days[d];
                    return (
                      <td key={d} className="border-b border-l border-slate-100 p-0.5">
                        <button onClick={() => setCell({ employee_id: e.id, name: e.name, date: d, status: a?.status || 'A', first_in: hm(a?.first_in), last_out: hm(a?.last_out), ot_minutes: a?.ot_minutes || 0, remark: '', manual: a?.manual, original: a })}
                          title={a ? `${ATT_LABEL[a.status] || a.status}${a.first_in ? ` ${hm(a.first_in)}–${hm(a.last_out)}` : ''}${a.late_minutes ? ` · late ${a.late_minutes}m` : ''}${a.ot_minutes ? ` · OT ${a.ot_minutes}m` : ''}${a.remark ? ` · ${a.remark}` : ''}` : 'not processed'}
                          className={`h-7 w-8 rounded font-semibold ${a ? CELL[a.status] : 'bg-slate-50 text-slate-300'} ${a?.manual ? 'ring-1 ring-indigo-400' : ''}`}>
                          {a ? a.status : '·'}{a?.late_minutes > 0 ? <sup className="text-rose-600">•</sup> : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="td text-center font-semibold text-emerald-700">{t.P}</td><td className="td text-center text-rose-600">{t.A}</td><td className="td text-center">{t.L}</td><td className="td text-center">{t.late}</td><td className="td text-center">{t.ot}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-slate-400">Red dot = late. Blue ring = changed by HR (machine data will not overwrite it). Click any cell to edit.</p>
      {cell && (
        <Modal open onClose={() => setCell(null)} title={`${cell.name} – ${fmtDate(cell.date, false)}`}
          footer={<>{cell.manual ? <Button variant="ghost" onClick={reset}>Reset to machine data</Button> : null}<Button variant="secondary" onClick={() => setCell(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
          {cell.original && <p className="mb-3 text-xs text-slate-500">Machine: {cell.original.first_in ? `${hm(cell.original.first_in)} – ${hm(cell.original.last_out) || '?'}` : 'no punch'} · {Math.round((cell.original.work_minutes || 0) / 6) / 10} h worked{cell.original.remark ? ` · ${cell.original.remark}` : ''}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Status" className="sm:col-span-2"><Select value={cell.status} onChange={(x) => setCell({ ...cell, status: x.target.value })} options={STATUS_OPTIONS} /></Field>
            <Field label="In"><input type="time" className="input" value={cell.first_in} onChange={(x) => setCell({ ...cell, first_in: x.target.value })} /></Field>
            <Field label="Out"><input type="time" className="input" value={cell.last_out} onChange={(x) => setCell({ ...cell, last_out: x.target.value })} /></Field>
            <Field label="OT minutes"><input type="number" className="input" value={cell.ot_minutes} onChange={(x) => setCell({ ...cell, ot_minutes: x.target.value })} /></Field>
            <Field label="Remark"><input className="input" value={cell.remark} onChange={(x) => setCell({ ...cell, remark: x.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </>
  );
}

function Today() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, loading } = useApi(`/hr/punches?date=${date}`, [date]);
  const unknown = useApi('/hr/punches?unknown=1');
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title={`Punches (${data?.length ?? '…'})`} className="lg:col-span-2" bodyClass="p-0" actions={<input type="date" className="input !w-40 !py-1" value={date} onChange={(e) => setDate(e.target.value)} />}>
        {loading ? <Spinner /> : !data.length ? <Empty text="No punches for this date" /> : (
          <div className="max-h-[60vh] overflow-auto"><table className="w-full"><thead className="sticky top-0"><tr>{['Time', 'Employee', 'Bio ID', 'Device', 'Source'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{data.map((p) => <tr key={p.id}><td className="td font-mono text-xs">{p.punch_time.slice(11)}</td><td className="td text-sm">{p.name ? <Link className="link" to={`/hr/employees/${p.employee_id}`}>{p.name}</Link> : <Badge color="red">unknown</Badge>}</td><td className="td text-xs">{p.biometric_id}</td><td className="td text-xs">{p.device}</td><td className="td text-xs">{p.source}</td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card title="Unknown biometric IDs" bodyClass="p-0">
        <p className="px-4 pt-3 text-xs text-slate-500">These IDs punched on a machine but no employee has that biometric ID. Open the employee and set the ID – old punches link automatically.</p>
        <ul className="divide-y divide-slate-100">{(unknown.data || []).map((u) => <li key={u.biometric_id} className="flex justify-between px-4 py-2 text-sm"><b>{u.biometric_id}</b><span className="text-xs text-slate-500">{u.n} punches · last {fmtDate(u.last)}</span></li>)}</ul>
      </Card>
    </div>
  );
}

function Devices() {
  const { data, reload } = useApi('/hr/devices');
  const st = useApi('/hr/settings');
  const [add, setAdd] = useState(null);
  const copy = (t) => { navigator.clipboard.writeText(t); toast('Copied'); };
  if (!data || !st.data) return <Spinner />;
  const host = st.data.adms_host;
  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="1 · ZKTeco / eSSL machine (direct, no software)">
          <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
            <li>On the machine: <b>Menu → Comm. → Cloud Server Setting</b> (eSSL: <i>ADMS</i>).</li>
            <li>Server address: <code className="rounded bg-slate-100 px-1">{host}</code> <button onClick={() => copy(host)}><Copy className="inline h-3.5 w-3.5 text-slate-400" /></button></li>
            <li>Server port: <b>80</b> (or 443 with HTTPS if the machine supports it). Enable domain name / DNS = ON. Proxy OFF.</li>
            <li>Machine needs internet (LAN / Wi-Fi). Within a minute it appears below as <b>waiting</b> – click Approve.</li>
            <li>From then every punch reaches the portal within seconds; old punches in the machine are also uploaded.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">Works with ZKTeco and eSSL models that have the ADMS / Push / Cloud server option (most face & finger models such as K90, X990, MB160, uFace, SpeedFace, eSSL X990 / Identix / AiFace). The user ID on the machine must equal the employee’s Biometric ID.</p>
        </Card>
        <Card title="2 · Any other system (API)">
          <p className="text-sm text-slate-700">eSSL eTimeTrackLite, ZKBioTime, Matrix COSEC, Realtime, Hikvision or a small sync script can push punches here:</p>
          <div className="mt-2 flex gap-1"><input className="input font-mono text-xs" readOnly value={st.data.punch_url} /><Button size="sm" variant="secondary" icon={Copy} onClick={() => copy(st.data.punch_url)} /></div>
          <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-2 text-[11px] text-slate-100">{`POST ${st.data.punch_url}
Content-Type: application/json
{"punches":[{"biometric_id":"101","time":"2026-11-17 09:02:11","device":"Gate 1"}]}`}</pre>
          <p className="mt-2 text-xs text-slate-500">3 · Or download the log from the machine / software as Excel and use <b>Import</b>. Keep the URL private.</p>
        </Card>
      </div>
      <Card title="Machines" bodyClass="p-0" actions={<Button size="sm" variant="secondary" onClick={() => setAdd({ name: '', serial_no: '', location: '' })}>Add by serial no.</Button>}>
        {!data.length ? <Empty text="No machine has connected yet" /> : (
          <table className="w-full"><thead><tr>{['Name', 'Serial no.', 'Location', 'Last seen', 'Punches', 'Status', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{data.map((d) => (
              <tr key={d.id}><td className="td">{d.name}</td><td className="td font-mono text-xs">{d.serial_no}</td><td className="td text-xs">{d.location}</td><td className="td text-xs">{fmtDate(d.last_seen)}{d.last_ip ? ` · ${d.last_ip}` : ''}</td><td className="td">{d.punches}</td>
                <td className="td">{d.active ? <Badge color="green">approved</Badge> : <Badge color="amber">waiting</Badge>}</td>
                <td className="td text-right">
                  <Button size="sm" variant={d.active ? 'ghost' : 'success'} onClick={async () => {
                    const name = d.active ? d.name : prompt('Name this machine (e.g. Kosamba main gate)', d.name) || d.name;
                    await api(`/hr/devices/${d.id}`, { method: 'PUT', body: { active: d.active ? 0 : 1, name } }); reload();
                  }}>{d.active ? 'Block' : 'Approve'}</Button>
                </td></tr>))}
            </tbody></table>
        )}
      </Card>
      {add && <Modal open onClose={() => setAdd(null)} title="Add machine" footer={<><Button variant="secondary" onClick={() => setAdd(null)}>Cancel</Button><Button onClick={async () => { await api('/hr/devices', { method: 'POST', body: add }); setAdd(null); reload(); }}>Save</Button></>}>
        <div className="grid gap-3"><Field label="Name"><input className="input" value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} /></Field>
          <Field label="Serial number (on the machine: System info)"><input className="input" value={add.serial_no} onChange={(e) => setAdd({ ...add, serial_no: e.target.value })} /></Field>
          <Field label="Location"><input className="input" value={add.location} onChange={(e) => setAdd({ ...add, location: e.target.value })} /></Field></div>
      </Modal>}
    </div>
  );
}

function Corrections() {
  const [status, setStatus] = useState('Pending');
  const { data, reload } = useApi(`/hr/attendance-requests?status=${status}`, [status]);
  const decide = async (id, approve) => { await api(`/hr/attendance-requests/${id}/decide`, { method: 'POST', body: { approve } }); toast(approve ? 'Approved – attendance updated' : 'Rejected'); reload(); };
  return (
    <div>
      <div className="mb-3"><Tabs value={status} onChange={setStatus} tabs={[{ value: 'Pending', label: 'Pending' }, { value: 'Approved', label: 'Approved' }, { value: 'Rejected', label: 'Rejected' }]} /></div>
      {!data ? <Spinner /> : !data.length ? <Empty text="No correction requests" /> : (
        <div className="card overflow-x-auto"><table className="w-full"><thead><tr>{['Employee', 'Date', 'In', 'Out', 'Reason', 'Asked on', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{data.map((q) => <tr key={q.id}><td className="td">{q.name}<div className="text-xs text-slate-400">{q.emp_code} · {q.department}</div></td><td className="td text-sm">{fmtDate(q.date, false)}</td><td className="td">{q.in_time || '—'}</td><td className="td">{q.out_time || '—'}</td><td className="td text-sm">{q.reason}</td><td className="td text-xs">{fmtDate(q.created_at)}</td>
            <td className="td whitespace-nowrap">{q.status === 'Pending' && <><Button size="sm" variant="success" icon={CheckCircle2} onClick={() => decide(q.id, true)}>Approve</Button> <Button size="sm" variant="secondary" icon={XCircle} onClick={() => decide(q.id, false)}>Reject</Button></>}</td></tr>)}</tbody></table></div>
      )}
    </div>
  );
}

export default function Attendance() {
  const [tab, setTab] = useState('register');
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [company, setCompany] = useState('');
  const [q, setQ] = useState('');
  const [imp, setImp] = useState(false);
  const { names } = useMasters();
  const key = useMemo(() => Math.random(), [imp]); // remount register after import
  return (
    <div>
      <PageHeader title="Attendance" subtitle="Biometric punches turn into daily attendance automatically: in / out, late, early, overtime, half day, missed punch, weekly off, holiday and approved leave."
        actions={<><Button variant="secondary" icon={FileSpreadsheet} onClick={() => setImp(true)}>Import punches / daily sheet</Button><Button variant="secondary" icon={Fingerprint} onClick={() => setTab('devices')}>Connect machine</Button></>} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'register', label: 'Monthly register' }, { value: 'today', label: 'Punches' }, { value: 'corrections', label: 'Correction requests' }, { value: 'devices', label: 'Machines & integration' }]} />
        {tab === 'register' && <>
          <input type="month" className="input !w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
          <div className="w-48"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
          <div className="relative w-56"><Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input className="input pl-9" placeholder="Name / code" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </>}
      </div>
      {tab === 'register' && <Register key={key} month={month} company={company} q={q} />}
      {tab === 'today' && <Today />}
      {tab === 'corrections' && <Corrections />}
      {tab === 'devices' && <Devices />}
      {imp && <SheetImport open title="Import attendance" endpoint="/hr/punches/import" batchSize={300} fields={PUNCH_FIELDS} onClose={() => setImp(false)} onDone={() => {}}
        help="Two formats work: (a) punch log – one row per punch with employee code / biometric ID and date-time (export from eTimeTrackLite, BioTime, machine USB download); (b) daily sheet – employee code, date, in time, out time. Attendance is calculated automatically after import." />}
      <ErrorBox error={null} />
    </div>
  );
}
