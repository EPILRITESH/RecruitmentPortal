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
      <Card title="AI agents" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="mb-3 text-sm">Status: {f.ai_available ? <Badge color="green">connected</Badge> : <Badge color="amber">offline – choose a provider</Badge>} {f.ai_env_key && <span className="text-xs text-slate-400">(key from environment variable)</span>}</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="AI provider" hint="Workers AI runs on your Cloudflare account, free up to the daily limit. Claude gives the best quality but needs Anthropic credits.">
            <Select value={f.ai_provider || 'workers'} onChange={set('ai_provider')} options={[{ value: 'workers', label: 'Cloudflare Workers AI (free)' }, { value: 'claude', label: 'Claude – Anthropic (paid, best)' }]} />
          </Field>
          {(f.ai_provider || 'workers') === 'workers' && <Field label="Workers AI model" hint="Leave blank for the default"><input className="input" value={f.ai_workers_model || ''} onChange={set('ai_workers_model')} placeholder={f.ai_workers_default} /></Field>}
          <div />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Anthropic API key" hint="Stored in the database. Leave •••• to keep the current key."><input className="input" type="password" value={f.anthropic_api_key || ''} onChange={set('anthropic_api_key')} placeholder="sk-ant-…" /></Field>
          <Field label="Claude model"><input className="input" value={f.ai_model || ''} onChange={set('ai_model')} /></Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {Object.entries(f.agents || {}).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={f[`ai_enabled_${k}`] !== '0'} onChange={set(`ai_enabled_${k}`)} />{label}</label>
          ))}
        </div>
      </Card>
      <Card title="Communication – automatic WhatsApp & email" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="mb-2 text-sm font-medium text-slate-700">WhatsApp</div>
        <div className="mb-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <b>Free (now):</b> click-to-send – every automatic message waits in the Outbox; “Send all one by one” opens WhatsApp with the text ready, you press send.<br />
          <b>Paid (later, fully automatic):</b> Meta WhatsApp Cloud API – business number + access token from Meta (developers.facebook.com → WhatsApp). Meta charges per message. Messages to people who have not written to you in 24 h must use an approved template – map them in Settings → Message templates.
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="WhatsApp mode">
            <Select value={f.whatsapp_mode || 'link'} onChange={set('whatsapp_mode')} options={[{ value: 'link', label: 'Click-to-send (free)' }, { value: 'cloud', label: 'WhatsApp Cloud API (paid, automatic)' }]} />
          </Field>
          {f.whatsapp_mode === 'cloud' && <>
            <Field label="Phone number ID"><input className="input" value={f.whatsapp_phone_id || ''} onChange={set('whatsapp_phone_id')} /></Field>
            <Field label="Permanent access token"><input className="input" type="password" value={f.whatsapp_token || ''} onChange={set('whatsapp_token')} /></Field>
          </>}
        </div>
        <div className="mb-2 mt-5 text-sm font-medium text-slate-700">Email</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Email provider" hint="Gmail / Google Workspace and Brevo are free. Resend / SMTP for later.">
            <Select value={f.email_provider || ''} onChange={set('email_provider')} placeholder="Not set – use Outbox" options={[
              { value: 'gmail', label: 'Gmail / Google Workspace (free, ~500/day)' }, { value: 'brevo', label: 'Brevo API (free 300/day)' },
              { value: 'resend', label: 'Resend API (paid / 100 a day free)' }, { value: 'smtp', label: 'Any SMTP server' }]} />
          </Field>
          {f.email_provider === 'gmail' && <>
            <Field label="Gmail / Workspace address" hint="Mails go out from this address"><input className="input" value={f.smtp_user || ''} onChange={set('smtp_user')} placeholder="recruiter@yourcompany.com" /></Field>
            <Field label="App password (16 letters)" hint="Google Account → Security → 2-Step Verification ON → App passwords → create “EPIL portal”"><input className="input" type="password" value={f.smtp_pass || ''} onChange={set('smtp_pass')} /></Field>
          </>}
          {(f.email_provider === 'brevo' || f.email_provider === 'resend') && <>
            <Field label="Provider API key"><input className="input" type="password" value={f.email_api_key || ''} onChange={set('email_api_key')} /></Field>
            <Field label="From address" hint="Must be verified with the provider"><input className="input" value={f.smtp_from || ''} onChange={set('smtp_from')} placeholder="hr@yourdomain.com" /></Field>
          </>}
          {f.email_provider === 'smtp' && <>
            <Field label="SMTP host"><input className="input" value={f.smtp_host || ''} onChange={set('smtp_host')} /></Field>
            <Field label="SMTP port"><input className="input" value={f.smtp_port || ''} onChange={set('smtp_port')} placeholder="465 or 587" /></Field>
            <Field label="SSL (465)"><Select value={f.smtp_secure || '0'} onChange={set('smtp_secure')} options={[{ value: '0', label: 'No (STARTTLS 587)' }, { value: '1', label: 'Yes (465)' }]} /></Field>
            <Field label="SMTP user"><input className="input" value={f.smtp_user || ''} onChange={set('smtp_user')} /></Field>
            <Field label="SMTP password"><input className="input" type="password" value={f.smtp_pass || ''} onChange={set('smtp_pass')} /></Field>
            <Field label="From address"><input className="input" value={f.smtp_from || ''} onChange={set('smtp_from')} /></Field>
          </>}
        </div>
        {f.email_provider && <div className="mt-3 flex items-center gap-2"><input className="input max-w-xs" placeholder="Send a test email to…" value={f._test_to || ''} onChange={set('_test_to')} />
          <Button size="sm" variant="secondary" onClick={async () => { await save(); try { const r = await api('/settings/test-email', { method: 'POST', body: { to: f._test_to } }); toast(r.status === 'sent' ? 'Test email sent ✔' : `Not sent: ${r.error}`, r.status === 'sent' ? 'ok' : 'error'); } catch (e) { toast(e.message, 'error'); } }}>Save & send test</Button></div>}
      </Card>
      <Card title="Screening & applications" actions={<Button size="sm" icon={Save} onClick={save}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Auto-screening of new candidates">
            <Select value={f.auto_screen || 'score'} onChange={set('auto_screen')} options={[{ value: 'off', label: 'Off – manual only' }, { value: 'score', label: 'Give score only' }, { value: 'decide', label: 'Score + complete Step 4' }]} />
          </Field>
          <Field label="Accept when score ≥"><input type="number" className="input" value={f.screen_accept || ''} onChange={set('screen_accept')} /></Field>
          <Field label="Reject when score <"><input type="number" className="input" value={f.screen_reject || ''} onChange={set('screen_reject')} /></Field>
          <Field label="Auto-reject low scores"><Select value={f.auto_reject || '0'} onChange={set('auto_reject')} options={[{ value: '0', label: 'No – recruiter decides' }, { value: '1', label: 'Yes' }]} /></Field>
        </div>
        <Field label="Webhook for job platforms / Zapier / Make (applications come straight into the portal)" className="mt-4"
          hint='POST JSON: {"name","mobile","email","platform":"NAUKRI","job_code":"IN-170","resume_url",...} – keep this URL private.'>
          <input className="input font-mono text-xs" readOnly value={f.inbound_url || ''} onFocus={(e) => e.target.select()} />
        </Field>
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
            {t.channel === 'whatsapp' && <div className="mt-2 grid gap-2 sm:grid-cols-3">
              <Field label="Meta approved template name (Cloud API)" hint="Leave empty for free click-to-send"><input className="input" value={e.wa_template || ''} onChange={(x) => setEdit({ ...edit, [t.key]: { ...e, wa_template: x.target.value } })} placeholder="e.g. interview_invite" /></Field>
              <Field label="Language code"><input className="input" value={e.wa_lang || ''} onChange={(x) => setEdit({ ...edit, [t.key]: { ...e, wa_lang: x.target.value } })} placeholder="en" /></Field>
              <Field label="Variables for {{1}}, {{2}}…" hint="Comma separated, in order"><input className="input" value={e.wa_params || ''} onChange={(x) => setEdit({ ...edit, [t.key]: { ...e, wa_params: x.target.value } })} placeholder="name,designation,company,interview_at" /></Field>
            </div>}
          </Card>
        );
      })}
    </div>
  );
}

function Platforms() {
  const { data, reload } = useApi('/platforms');
  const [edit, setEdit] = useState(null);
  if (!data) return <Spinner />;
  const save = async () => { await api(`/platforms/${encodeURIComponent(edit.name)}`, { method: 'PUT', body: edit }); toast('Platform saved'); setEdit(null); reload(); };
  const M = { careers: 'Careers page (auto)', email: 'Email to consultancy (auto)', api: 'API / webhook (auto)', assisted: 'Assisted – copy & open site', whatsapp: 'WhatsApp share' };
  return (
    <Card title="Job platforms" bodyClass="p-0" actions={<Button size="sm" icon={Plus} onClick={() => setEdit({ name: '', method: 'assisted', active: 1, sort: 50 })}>Add platform</Button>}>
      <p className="px-4 pt-3 text-xs text-slate-500">Work India, Apna, LinkedIn, Naukri and Indeed do not give small employers an open posting API, so they are “assisted”: the portal copies the post and opens the site. If a platform gives you API / partner access (or you use Zapier / Make), switch it to “API” and paste the endpoint – posting then happens automatically.</p>
      <table className="w-full">
        <thead><tr><th className="th">Platform</th><th className="th">How we post</th><th className="th">Email / site / API</th><th className="th">Active</th><th className="th" /></tr></thead>
        <tbody>{data.map((p) => (
          <tr key={p.name}><td className="td font-medium">{p.name}</td><td className="td text-sm">{M[p.method]}</td>
            <td className="td max-w-xs truncate text-xs text-slate-500">{p.email || p.api_url || p.post_url || '—'}</td>
            <td className="td">{p.active ? <Badge color="green">yes</Badge> : <Badge>no</Badge>}</td>
            <td className="td text-right"><Button size="sm" variant="ghost" onClick={() => setEdit({ ...p, api_key: p.api_key ? '••••' : '' })}>Edit</Button></td></tr>
        ))}</tbody>
      </table>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.name ? `Platform – ${edit.name}` : 'Add platform'} footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button><Button onClick={save} disabled={!edit?.name}>Save</Button></>}>
        {edit && <div className="grid gap-3">
          <Field label="Name (same as candidate source)"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value.toUpperCase() })} /></Field>
          <Field label="How to post"><Select value={edit.method} onChange={(e) => setEdit({ ...edit, method: e.target.value })} options={Object.entries(M).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          {edit.method === 'email' && <Field label="Consultancy email"><input className="input" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>}
          {edit.method === 'assisted' && <Field label="Employer page to post a job"><input className="input" value={edit.post_url || ''} onChange={(e) => setEdit({ ...edit, post_url: e.target.value })} /></Field>}
          {edit.method === 'api' && <>
            <Field label="API endpoint (POST JSON)" hint="Receives code, title, company, salary, description, apply_link…"><input className="input" value={edit.api_url || ''} onChange={(e) => setEdit({ ...edit, api_url: e.target.value })} /></Field>
            <Field label="API key (sent as Bearer)"><input className="input" type="password" value={edit.api_key || ''} onChange={(e) => setEdit({ ...edit, api_key: e.target.value })} /></Field>
          </>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked ? 1 : 0 })} />Active</label>
        </div>}
      </Modal>
    </Card>
  );
}

function Automations() {
  const { data, reload } = useApi('/automations');
  const [add, setAdd] = useState(null);
  if (!data) return <Spinner />;
  const toggle = async (a) => { await api(`/automations/${a.id}`, { method: 'PUT', body: { enabled: a.enabled ? 0 : 1 } }); reload(); };
  const setTpl = async (a, key) => { await api(`/automations/${a.id}`, { method: 'PUT', body: { template_key: key } }); toast('Saved'); reload(); };
  const del = async (a) => { if (window.confirm('Delete this rule?')) { await api(`/automations/${a.id}`, { method: 'DELETE' }); reload(); } };
  return (
    <Card title="Automation rules – what happens on each action" bodyClass="p-0" actions={<Button size="sm" icon={Plus} onClick={() => setAdd({ event: 'S04:Accepted', channel: 'whatsapp', recipient: 'candidate', template_key: '' })}>Add rule</Button>}>
      <table className="w-full">
        <thead><tr><th className="th">When</th><th className="th">Send</th><th className="th">To</th><th className="th">Message template</th><th className="th">Also</th><th className="th">On</th><th className="th" /></tr></thead>
        <tbody>{data.rules.map((a) => (
          <tr key={a.id} className={a.enabled ? '' : 'opacity-50'}>
            <td className="td text-sm">{data.events[a.event] || a.event}</td>
            <td className="td"><Badge color={a.channel === 'email' ? 'blue' : 'green'}>{a.channel}</Badge></td>
            <td className="td text-sm">{data.recipients[a.recipient]}</td>
            <td className="td"><Select value={a.template_key} onChange={(e) => setTpl(a, e.target.value)} options={data.templates.filter((t) => t.channel === a.channel).map((t) => ({ value: t.key, label: t.name }))} /></td>
            <td className="td text-xs">{a.complete_step ? `completes Step ${Number(a.complete_step.slice(1))}` : ''}</td>
            <td className="td"><input type="checkbox" className="h-4 w-4 accent-indigo-600" checked={!!a.enabled} onChange={() => toggle(a)} /></td>
            <td className="td"><button onClick={() => del(a)} className="text-slate-400 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button></td>
          </tr>
        ))}</tbody>
      </table>
      <Modal open={!!add} onClose={() => setAdd(null)} title="Add automation rule" footer={<><Button variant="secondary" onClick={() => setAdd(null)}>Cancel</Button><Button disabled={!add?.template_key} onClick={async () => { await api('/automations', { method: 'POST', body: add }); setAdd(null); reload(); }}>Add</Button></>}>
        {add && <div className="grid gap-3">
          <Field label="When"><Select value={add.event} onChange={(e) => setAdd({ ...add, event: e.target.value })} options={Object.entries(data.events).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label="Channel"><Select value={add.channel} onChange={(e) => setAdd({ ...add, channel: e.target.value, template_key: '' })} options={['whatsapp', 'email']} /></Field>
          <Field label="To"><Select value={add.recipient} onChange={(e) => setAdd({ ...add, recipient: e.target.value })} options={Object.entries(data.recipients).map(([v, l]) => ({ value: v, label: l }))} /></Field>
          <Field label="Template"><Select value={add.template_key} onChange={(e) => setAdd({ ...add, template_key: e.target.value })} placeholder="Select" options={data.templates.filter((t) => t.channel === add.channel).map((t) => ({ value: t.key, label: t.name }))} /></Field>
        </div>}
      </Modal>
    </Card>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('general');
  return (
    <div>
      <PageHeader title="Settings" subtitle="Admin only – team, steps, master lists, templates, AI and communication." />
      <div className="mb-5"><Tabs value={tab} onChange={setTab} tabs={[{ value: 'general', label: 'General & AI' }, { value: 'steps', label: 'Steps & TAT' }, { value: 'platforms', label: 'Job platforms' }, { value: 'automations', label: 'Automations' }, { value: 'users', label: 'Users' }, { value: 'masters', label: 'Master lists' }, { value: 'templates', label: 'Message templates' }, { value: 'holidays', label: 'Holidays' }]} /></div>
      {tab === 'general' && <General />}
      {tab === 'steps' && <Steps />}
      {tab === 'platforms' && <Platforms />}
      {tab === 'automations' && <Automations />}
      {tab === 'users' && <Users />}
      {tab === 'masters' && <Masters />}
      {tab === 'templates' && <Templates />}
      {tab === 'holidays' && <Holidays />}
    </div>
  );
}
