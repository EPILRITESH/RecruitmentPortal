import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bot, Send, Sparkles, FileSearch, Target, MessageSquare, FileText, ClipboardCheck, Bell, BarChart3, Upload } from 'lucide-react';
import { api, auth, fmtDate } from '../api';
import { useApi, Card, Button, Badge, PageHeader, Spinner, ErrorBox } from '../components/ui';

const AGENTS = [
  { key: 'jd', icon: FileText, name: 'JD Generator', where: 'Step 1 · Requirement page', does: 'Writes the full JD + a short Work India / Apna / WhatsApp post from the requirement form.' },
  { key: 'cv', icon: FileSearch, name: 'CV Parser', where: 'Add candidate', does: 'Reads a PDF / photo resume and fills name, mobile, experience, salary, skills. Duplicate mobile check runs automatically.' },
  { key: 'screen', icon: Target, name: 'Screening & Match', where: 'Step 4 · Candidate page', does: 'Scores the candidate 0-100 against the JD, lists strengths / gaps and gives phone-screening questions.' },
  { key: 'message', icon: MessageSquare, name: 'Outreach', where: 'Steps 5-7, 11, 20', does: 'Drafts WhatsApp / email messages: interest check, form link, interview invite, selection, feedback.' },
  { key: 'assistant', icon: Bot, name: 'Recruitment Assistant', where: 'This page', does: 'Answers questions on live data – pending work, delays, sources, retention – and suggests next actions.' },
];
const BUILT_IN = [
  { icon: Bell, name: 'Reminder & Escalation Engine', does: 'Creates every next step with a planned date (working days, holidays skipped) and pushes late work to the Rescue Board / Ritesh Sir after 48 h.' },
  { icon: ClipboardCheck, name: 'Onboarding Agent', does: 'On final selection, creates the ONB record and plans pre-onboarding, Day 1, training, 6-day and 30/60/90-day checks from the joining date.' },
  { icon: BarChart3, name: 'MIS Agent', does: 'Builds funnel, source cost, step on-time %, retention and portal summary reports live – no Looker refresh needed.' },
];
const SAMPLES = ['Which requirements are open for more than 30 days?', 'Which steps are most delayed and who owns them?', 'Which source gives the best conversion and what does it cost?', 'Summarise this month’s hiring for Ritesh Sir in 5 points.'];

export default function AIAgents() {
  const status = useApi(auth.user?.role === 'admin' ? '/settings' : null);
  const runs = useApi('/ai/runs');
  const [q, setQ] = useState('');
  const [chat, setChat] = useState([]);
  const [busy, setBusy] = useState(false);
  const [cvOut, setCvOut] = useState(null);
  const [cvBusy, setCvBusy] = useState(false);
  const [err, setErr] = useState(null);

  const ask = async (question) => {
    const text = (question || q).trim();
    if (!text) return;
    setQ(''); setBusy(true); setErr(null);
    setChat((c) => [...c, { role: 'user', text }]);
    try {
      const r = await api('/ai/ask', { method: 'POST', body: { question: text } });
      setChat((c) => [...c, { role: 'ai', text: r.answer, items: r.items, actions: r.suggested_actions, mode: r._mode }]);
      runs.reload();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const parseCv = async (f) => {
    setCvBusy(true); setCvOut(null);
    try { const form = new FormData(); form.append('resume', f); setCvOut(await api('/candidates/parse-cv', { method: 'POST', form })); }
    catch (e) { setErr(e.message); } finally { setCvBusy(false); }
  };

  const s = status.data;
  return (
    <div className="space-y-5">
      <PageHeader title="AI Recruitment Agents" subtitle="Agents work inside each step of the FMS flow. Each agent can be switched on / off in Settings → AI. Without an API key the portal uses simple offline rules." />
      {s && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${s.ai_available ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          {s.ai_available
            ? <>AI is <b>on</b> – provider: <b>{s.ai_provider === 'workers' ? 'Cloudflare Workers AI (free)' : 'Claude (Anthropic)'}</b>. Change it in <Link className="underline" to="/settings">Settings → AI</Link>.</>
            : <>AI is in <b>offline mode</b>. Choose a provider in <Link className="underline" to="/settings">Settings → AI</Link> – Cloudflare Workers AI is free, Claude needs Anthropic credits.</>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {AGENTS.map((a) => (
          <div key={a.key} className="card p-4">
            <div className="flex items-center gap-2"><div className="rounded-lg bg-indigo-50 p-2 text-indigo-600"><a.icon className="h-4 w-4" /></div><span className="font-semibold text-slate-800">{a.name} Agent</span>
              {s && <Badge color={s[`ai_enabled_${a.key}`] === '0' ? 'slate' : s.ai_available ? 'green' : 'amber'} className="ml-auto">{s[`ai_enabled_${a.key}`] === '0' ? 'off' : s.ai_available ? 'AI on' : 'offline'}</Badge>}
            </div>
            <p className="mt-2 text-sm text-slate-600">{a.does}</p>
            <p className="mt-1 text-xs text-slate-400">Works in: {a.where}</p>
          </div>
        ))}
        {BUILT_IN.map((a) => (
          <div key={a.name} className="card p-4">
            <div className="flex items-center gap-2"><div className="rounded-lg bg-emerald-50 p-2 text-emerald-600"><a.icon className="h-4 w-4" /></div><span className="font-semibold text-slate-800">{a.name}</span><Badge color="green" className="ml-auto">always on</Badge></div>
            <p className="mt-2 text-sm text-slate-600">{a.does}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-indigo-500" />Ask the Recruitment Assistant</span>} className="lg:col-span-2">
          <div className="mb-3 max-h-[420px] min-h-[160px] space-y-3 overflow-y-auto">
            {!chat.length && (
              <div className="flex flex-wrap gap-2">{SAMPLES.map((x) => <button key={x} onClick={() => ask(x)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:border-indigo-300 hover:text-indigo-700">{x}</button>)}</div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'ml-auto max-w-[85%] rounded-xl bg-indigo-600 px-3 py-2 text-sm text-white' : 'max-w-[95%] rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-800'}>
                <div className="whitespace-pre-wrap">{m.text}</div>
                {m.items?.length > 0 && <ul className="mt-1 list-disc pl-5">{m.items.map((x) => <li key={x}>{x}</li>)}</ul>}
                {m.actions?.length > 0 && <div className="mt-2 border-t border-slate-200 pt-2 text-xs"><b>Next actions:</b><ul className="list-disc pl-4">{m.actions.map((a) => <li key={a}>{a}</li>)}</ul></div>}
              </div>
            ))}
            {busy && <Spinner label="Thinking…" />}
          </div>
          <ErrorBox error={err} />
          <form onSubmit={(e) => { e.preventDefault(); ask(); }} className="flex gap-2">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask about pending work, delays, sources, retention…" />
            <Button icon={Send} loading={busy}>Ask</Button>
          </form>
        </Card>

        <Card title="Try the CV Parser">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 hover:border-indigo-300">
            <Upload className="h-6 w-6" />{cvBusy ? 'Reading…' : 'Drop a resume PDF / photo'}
            <input type="file" className="hidden" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" onChange={(e) => e.target.files[0] && parseCv(e.target.files[0])} />
          </label>
          {cvOut && (
            <dl className="mt-3 space-y-1 text-sm">
              {['name', 'mobile', 'email', 'experience_years', 'current_company', 'qualification', 'expected_ctc', 'location'].map((k) => <div key={k} className="flex justify-between gap-2"><dt className="text-slate-400">{k.replace('_', ' ')}</dt><dd className="text-right text-slate-700">{String(cvOut[k] || '—')}</dd></div>)}
              <div className="pt-1 text-xs text-slate-500">{cvOut.skills?.join(', ')}</div>
            </dl>
          )}
        </Card>
      </div>

      <Card title="Agent activity log" bodyClass="p-0">
        {runs.loading && !runs.data ? <Spinner /> : (
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full">
              <thead><tr><th className="th">When</th><th className="th">Agent</th><th className="th">Record</th><th className="th">Mode</th><th className="th">By</th></tr></thead>
              <tbody>{(runs.data || []).map((r) => (
                <tr key={r.id}><td className="td text-xs">{fmtDate(r.created_at)}</td><td className="td">{AGENTS.find((a) => a.key === r.agent)?.name || r.agent}</td><td className="td text-xs">{r.entity_type ? `${r.entity_type} #${r.entity_id}` : '—'}</td><td className="td"><Badge color={r.mode === 'offline' ? 'slate' : 'indigo'}>{r.mode}</Badge></td><td className="td text-xs">{r.user_name}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
