import { useEffect, useState } from 'react';
import { Plus, Trash2, Save } from 'lucide-react';
import { api, ROLE_LABEL } from '../api';
import { useApi, Card, PageHeader, Spinner, Tabs, Button, Field, Select, Modal, Badge, toast, ErrorBox } from '../components/ui';

function General() {
  const { data, loading } = useApi('/settings');
  const [f, setF] = useState({});
  useEffect(() => { if (data) setF(data); }, [data]);
  if (loading || !data) return <Spinner />;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const save = async () => { await api('/settings', { method: 'PUT', body: f }); toast('Settings saved'); };
  return (
    <div className="space-y-5">
      <Card title="Company & working calendar" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Company name"><input className="input" value={f.company_name || ''} onChange={set('company_name')} /></Field>
          <Field label="Portal public URL" hint="Used in candidate form links"><input className="input" value={f.public_url || ''} onChange={set('public_url')} /></Field>
          <Field label="Office address (interview location)"><input className="input" value={f.office_address || ''} onChange={set('office_address')} /></Field>
          <Field label="Office start hour"><input type="number" className="input" value={f.work_start_hour || ''} onChange={set('work_start_hour')} /></Field>
          <Field label="Office end hour" hint="Planned time for same-day steps"><input type="number" className="input" value={f.work_end_hour || ''} onChange={set('work_end_hour')} /></Field>
          <Field label="Weekly off (0=Sun … 6=Sat)" hint="Comma separated"><input className="input" value={f.weekly_off || ''} onChange={set('weekly_off')} /></Field>
          <Field label="Escalate after (hours late)"><input type="number" className="input" value={f.escalation_hours || ''} onChange={set('escalation_hours')} /></Field>
        </div>
      </Card>
      <Card title="AI agents (Claude)" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="mb-3 text-sm">Status: {f.ai_available ? <Badge color="green">connected</Badge> : <Badge color="amber">offline – add API key</Badge>} {f.ai_env_key && <span className="text-xs text-slate-400">(key from environment variable)</span>}</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Anthropic API key" hint="Stored in the database. Leave •••• to keep the current key."><input className="input" type="password" value={f.anthropic_api_key || ''} onChange={set('anthropic_api_key')} placeholder="sk-ant-…" /></Field>
          <Field label="Model"><input className="input" value={f.ai_model || ''} onChange={set('ai_model')} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {Object.entries(f.agents || {}).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={f[`ai_enabled_${k}`] !== '0'} onChange={set(`ai_enabled_${k}`)} />{label}</label>
          ))}
        </div>
      </Card>
      <Card title="Communication" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="WhatsApp mode" hint="Link = opens WhatsApp Web/app with the message ready. Cloud = sends via Meta WhatsApp Cloud API.">
            <Select value={f.whatsapp_mode || 'link'} onChange={set('whatsapp_mode')} options={[{ value: 'link', label: 'Click-to-chat link (free)' }, { value: 'cloud', label: 'WhatsApp Cloud API' }]} />
          </Field>
          <Field label="WhatsApp phone number ID"><input className="input" value={f.whatsapp_phone_id || ''} onChange={set('whatsapp_phone_id')} /></Field>
          <Field label="WhatsApp access token"><input className="input" type="password" value={f.whatsapp_token || ''} onChange={set('whatsapp_token')} /></Field>
          <Field label="SMTP host"><input className="input" value={f.smtp_host || ''} onChange={set('smtp_host')} placeholder="smtp.gmail.com" /></Field>
          <Field label="SMTP port"><input className="input" value={f.smtp_port || ''} onChange={set('smtp_port')} placeholder="587" /></Field>
          <Field label="SSL (port 465)"><Select value={f.smtp_secure || '0'} onChange={set('smtp_secure')} options={[{ value: '0', label: 'No (STARTTLS)' }, { value: '1', label: 'Yes' }]} /></Field>
          <Field label="SMTP user"><input className="input" value={f.smtp_user || ''} onChange={set('smtp_user')} /></Field>
          <Field label="SMTP password / app password"><input className="input" type="password" value={f.smtp_pass || ''} onChange={set('smtp_pass')} /></Field>
          <Field label="From address"><input className="input" value={f.smtp_from || ''} onChange={set('smtp_from')} /></Field>
        </div>
      </Card>
    </div>
  );
}

function Steps() {
  const { data, reload } = useApi('/steps');
  const users = useApi('/users');
  const [edits, setEdits] = useState({});
  if (!data || !users.data) return <Spinner />;
  const save = async (code) => { await api(`/steps/${code}`, { method: 'PUT', body: edits[code] }); toast('Step updated'); setEdits({ ...edits, [code]: undefined }); reload(); };
  const ch = (s, k, v) => setEdits({ ...edits, [s.code]: { ...(edits[s.code] || {}), [k]: v } });
  return (
    <Card title="Workflow steps – doer & TAT" bodyClass="p-0">
      <p className="px-4 pt-3 text-xs text-slate-500">TAT = working days after the previous step is done (0 = same day). For onboarding steps TAT = days from the joining date (negative = before joining).</p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead><tr><th className="th">#</th><th className="th">Step</th><th className="th">Stage</th><th className="th">Doer role</th><th className="th">Fixed person</th><th className="th">TAT (days)</th><th className="th" /></tr></thead>
          <tbody>{data.map((s) => {
            const e = { ...s, ...(edits[s.code] || {}) };
            return (
              <tr key={s.code}>
                <td className="td text-xs text-slate-400">{s.no}</td>
                <td className="td"><input className="input !py-1" value={e.name} onChange={(x) => ch(s, 'name', x.target.value)} /></td>
                <td className="td text-xs capitalize">{s.stage}</td>
                <td className="td"><Select value={e.doer_role} onChange={(x) => ch(s, 'doer_role', x.target.value)} options={Object.entries(ROLE_LABEL).map(([v, l]) => ({ value: v, label: l }))} /></td>
                <td className="td"><Select value={e.doer_user_id || ''} onChange={(x) => ch(s, 'doer_user_id', x.target.value)} placeholder="Anyone with role" options={users.data.users.map((u) => ({ value: u.id, label: u.name }))} /></td>
                <td className="td w-24"><input type="number" className="input !py-1" value={e.tat_days} onChange={(x) => ch(s, 'tat_days', x.target.value)} /></td>
                <td className="td">{edits[s.code] && <Button size="sm" onClick={() => save(s.code)}>Save</Button>}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </Card>
  );
}

function Users() {
  const { data, reload } = useApi('/users');
  const [f, setF] = useState(null);
  const [err, setErr] = useState(null);
  if (!data) return <Spinner />;
  const save = async () => {
    setErr(null);
    try {
      if (f.id) await api(`/users/${f.id}`, { method: 'PUT', body: f }); else await api('/users', { method: 'POST', body: f });
      toast('User saved'); setF(null); reload();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Card title="Users & roles" actions={<Button size="sm" icon={Plus} onClick={() => setF({ role: 'recruiter' })}>Add user</Button>} bodyClass="p-0">
      <table className="w-full">
        <thead><tr><th className="th">Name</th><th className="th">Email (login)</th><th className="th">Role</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody>{data.users.map((u) => (
          <tr key={u.id}><td className="td font-medium">{u.name}</td><td className="td text-sm">{u.email}</td><td className="td text-sm">{data.roles[u.role]}</td>
            <td className="td">{u.active ? <Badge color="green">active</Badge> : <Badge>disabled</Badge>}</td>
            <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setF({ ...u })}>Edit</Button></td></tr>
        ))}</tbody>
      </table>
      <Modal open={!!f} onClose={() => setF(null)} title={f?.id ? 'Edit user' : 'Add user'} footer={<><Button variant="secondary" onClick={() => setF(null)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        {f && <div className="grid gap-3">
          <Field label="Name"><input className="input" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email (login)"><input className="input" disabled={!!f.id} value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Phone"><input className="input" value={f.phone || ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={Object.entries(data.roles).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label={f.id ? 'New password (leave blank to keep)' : 'Password (default epil@123)'}><input className="input" type="password" value={f.password || ''} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          {f.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.active} onChange={(e) => setF({ ...f, active: e.target.checked ? 1 : 0 })} />Active</label>}
          <ErrorBox error={err} />
        </div>}
      </Modal>
    </Card>
  );
}

function Masters() {
  const { data, reload } = useApi('/masters');
  const [type, setType] = useState('company');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  if (!data) return <Spinner />;
  const add = async () => { if (!name) return; await api('/masters', { method: 'POST', body: { type, name, email } }); setName(''); setEmail(''); reload(); };
  const del = async (id) => { await api(`/masters/${id}`, { method: 'DELETE' }); reload(); };
  return (
    <Card title="Master lists (dropdowns)">
      <div className="mb-4"><Tabs value={type} onChange={setType} tabs={['company', 'source', 'requester', 'designation', 'department'].map((t) => ({ value: t, label: t, count: data[t]?.length || 0 }))} /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input max-w-xs" placeholder={`New ${type}`} value={name} onChange={(e) => setName(e.target.value)} />
        {type === 'source' && <input className="input max-w-xs" placeholder="Consultancy email" value={email} onChange={(e) => setEmail(e.target.value)} />}
        <Button icon={Plus} onClick={add}>Add</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {(data[type] || []).map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white py-1 pl-3 pr-1 text-sm">
            {m.name}{m.email && <span className="text-xs text-slate-400">· {m.email}</span>}
            <button onClick={() => del(m.id)} className="rounded-full p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3 w-3" /></button>
          </span>
        ))}
      </div>
    </Card>
  );
}

function Holidays() {
  const { data, reload } = useApi('/holidays');
  const [d, setD] = useState(''); const [n, setN] = useState('');
  if (!data) return <Spinner />;
  return (
    <Card title="Holidays (skipped when planning step dates)">
      <div className="mb-3 flex flex-wrap gap-2">
        <input type="date" className="input max-w-[180px]" value={d} onChange={(e) => setD(e.target.value)} />
        <input className="input max-w-xs" placeholder="Holiday name" value={n} onChange={(e) => setN(e.target.value)} />
        <Button icon={Plus} onClick={async () => { if (!d) return; await api('/holidays', { method: 'POST', body: { date: d, name: n } }); setD(''); setN(''); reload(); }}>Add</Button>
      </div>
      <ul className="divide-y divide-slate-100 text-sm">
        {data.map((h) => <li key={h.date} className="flex items-center justify-between py-1.5"><span>{h.date} – {h.name}</span><button onClick={async () => { await api(`/holidays/${h.date}`, { method: 'DELETE' }); reload(); }} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></li>)}
        {!data.length && <li className="py-2 text-slate-400">No holidays added.</li>}
      </ul>
    </Card>
  );
}

function Templates() {
  const { data, reload } = useApi('/templates');
  const [edit, setEdit] = useState({});
  if (!data) return <Spinner />;
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-500">Variables: {'{{name}} {{designation}} {{company}} {{salary}} {{interview_at}} {{joining_date}} {{location}} {{apply_link}} {{feedback_link}} {{recruiter}} {{mobile}} {{code}} {{offered_salary}}'}</p>
      {data.map((t) => {
        const e = { ...t, ...(edit[t.key] || {}) };
        return (
          <Card key={t.key} title={<span>{t.name} <Badge color={t.channel === 'email' ? 'blue' : 'green'} className="ml-2">{t.channel}</Badge></span>}
            actions={edit[t.key] && <Button size="sm" onClick={async () => { await api(`/templates/${t.key}`, { method: 'PUT', body: e }); toast('Template saved'); setEdit({ ...edit, [t.key]: undefined }); reload(); }}>Save</Button>}>
            {t.channel === 'email' && <input className="input mb-2" value={e.subject} onChange={(x) => setEdit({ ...edit, [t.key]: { ...e, subject: x.target.value } })} />}
            <textarea className="input font-mono text-[13px]" rows={t.channel === 'email' ? 8 : 3} value={e.body} onChange={(x) => setEdit({ ...edit, [t.key]: { ...e, body: x.target.value } })} />
          </Card>
        );
      })}
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <PageHeader title="Settings" subtitle="Admin only – team, steps, master lists, templates, AI and communication." />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'general', label: 'General & AI' }, { value: 'steps', label: 'Steps & TAT' }, { value: 'users', label: 'Users' }, { value: 'masters', label: 'Master lists' }, { value: 'templates', label: 'Message templates' }, { value: 'holidays', label: 'Holidays' }]} /></div>
      {tab === 'general' && <General />}
      {tab === 'steps' && <Steps />}
      {tab === 'users' && <Users />}
      {tab === 'masters' && <Masters />}
      {tab === 'templates' && <Templates />}
      {tab === 'holidays' && <Holidays />}
    </div>
  );
}
