import { useState } from 'react';
import { Send, Copy, ExternalLink, CheckCircle2, Globe, Mail, MessageCircle, Plug, MousePointerClick, Plus } from 'lucide-react';
import { api, fmtDate } from '../api';
import { useApi, Card, Button, Badge, Modal, Field, ErrorBox, toast, Select } from './ui';

const METHOD = {
  careers: { label: 'Auto – careers page', icon: Globe, color: 'green' },
  email: { label: 'Auto – email to consultancy', icon: Mail, color: 'green' },
  api: { label: 'Auto – API', icon: Plug, color: 'green' },
  whatsapp: { label: 'WhatsApp share', icon: MessageCircle, color: 'blue' },
  assisted: { label: 'Assisted (copy + open)', icon: MousePointerClick, color: 'amber' },
};

export default function JobPosting({ requirement, onChange }) {
  const { data, reload } = useApi(`/requirements/${requirement.id}/posts`, [requirement.id, requirement.jd_status]);
  const [sel, setSel] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [actions, setActions] = useState(null); // pending assisted actions
  const [manual, setManual] = useState(null);
  if (!data) return null;
  const approved = requirement.jd_status === 'Approved';
  const postOf = (name) => data.posts.find((p) => p.platform === name);
  const countOf = (name) => data.counts.find((c) => c.source === name)?.n || 0;
  const toggle = (n) => setSel((s) => (s.includes(n) ? s.filter((x) => x !== n) : [...s, n]));
  const copy = (t) => { navigator.clipboard.writeText(t); toast('Copied'); };

  const post = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api(`/requirements/${requirement.id}/post`, { method: 'POST', body: { platforms: sel } });
      const pending = r.results.filter((x) => x.status === 'Pending');
      const posted = r.results.filter((x) => x.status === 'Posted').length;
      const failed = r.results.filter((x) => x.status === 'Failed');
      if (posted) toast(`Posted on ${posted} platform(s)`);
      if (failed.length) setErr(failed.map((f) => `${f.platform}: ${f.error}`).join(' · '));
      if (pending.length) setActions(pending.map((p) => ({ ...p, url: '' })));
      setSel([]); reload(); onChange?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  const confirm = async (a, i) => {
    await api(`/job-posts/${a.post_id}/confirm`, { method: 'POST', body: { post_url: a.url || null } });
    toast(`${a.platform} marked as posted`);
    setActions((x) => { const n = x.filter((_, j) => j !== i); return n.length ? n : null; });
    reload(); onChange?.();
  };
  const saveManual = async () => {
    await api(`/requirements/${requirement.id}/posts/manual`, { method: 'POST', body: manual });
    toast('Manual post recorded'); setManual(null); reload(); onChange?.();
  };

  return (
    <Card title="Job posting" actions={<Button size="sm" variant="ghost" icon={Plus} onClick={() => setManual({ platform: '', post_url: '' })}>Record manual post</Button>}>
      {!approved && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">Approve the JD above first – then select platforms and post from here.</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        {data.platforms.map((p) => {
          const m = METHOD[p.method] || METHOD.assisted;
          const existing = postOf(p.name);
          const done = existing?.status === 'Posted';
          return (
            <label key={p.name} className={`flex cursor-pointer items-start gap-2.5 rounded-lg border p-2.5 text-sm transition ${sel.includes(p.name) ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200 hover:border-slate-300'} ${!approved ? 'opacity-60' : ''}`}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-indigo-600" disabled={!approved || done} checked={sel.includes(p.name) || done} onChange={() => toggle(p.name)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-slate-800">{p.name}</span>
                  {done ? <Badge color="green">posted {fmtDate(existing.posted_at, false)}</Badge> : existing?.status === 'Pending' ? <Badge color="amber">waiting</Badge> : existing?.status === 'Failed' ? <Badge color="red">failed</Badge> : null}
                  {countOf(p.name) > 0 && <Badge color="indigo">{countOf(p.name)} applied</Badge>}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500"><m.icon className="h-3 w-3" />{m.label}{p.email ? ` · ${p.email}` : ''}</div>
              </div>
              <button type="button" title="Copy apply link for this platform" onClick={(e) => { e.preventDefault(); copy(p.apply_link); }} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><Copy className="h-3.5 w-3.5" /></button>
            </label>
          );
        })}
      </div>
      <ErrorBox error={err} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button icon={Send} onClick={post} loading={busy} disabled={!approved || !sel.length}>Post to {sel.length || ''} selected</Button>
        <Button variant="secondary" icon={Copy} onClick={() => copy(data.text)}>Copy job post text</Button>
        <span className="text-xs text-slate-400">Every platform gets its own apply link, so applicants arrive in the portal tagged with the right source.</span>
      </div>

      {actions && (
        <Modal open wide onClose={() => setActions(null)} title="Finish posting on these platforms">
          <p className="mb-3 text-sm text-slate-600">These platforms do not allow automatic posting. For each one: copy the post, open the site, paste and publish, then confirm here (paste the job link if you have it).</p>
          <div className="space-y-3">
            {actions.map((a, i) => (
              <div key={a.platform} className="rounded-lg border border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold">{a.platform}</span>
                  <div className="flex gap-1.5">
                    {a.text && <Button size="sm" variant="secondary" icon={Copy} onClick={() => copy(a.text)}>Copy post</Button>}
                    {a.link && <a href={a.link} target="_blank" rel="noreferrer"><Button size="sm" variant={a.action === 'whatsapp' ? 'whatsapp' : 'secondary'} icon={ExternalLink}>{a.action === 'email' ? 'Open email' : a.action === 'whatsapp' ? 'Share on WhatsApp' : 'Open site'}</Button></a>}
                  </div>
                </div>
                {a.note && <p className="mb-2 text-xs text-slate-500">{a.note}</p>}
                <div className="flex gap-2">
                  <input className="input" placeholder="Job link on the platform (optional)" value={a.url} onChange={(e) => setActions((x) => x.map((y, j) => (j === i ? { ...y, url: e.target.value } : y)))} />
                  <Button variant="success" icon={CheckCircle2} onClick={() => confirm(a, i)}>Posted</Button>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {manual && (
        <Modal open onClose={() => setManual(null)} title="Record a job posted outside the portal"
          footer={<><Button variant="secondary" onClick={() => setManual(null)}>Cancel</Button><Button onClick={saveManual} disabled={!manual.platform}>Save</Button></>}>
          <div className="space-y-3">
            <Field label="Platform"><Select value={manual.platform} onChange={(e) => setManual({ ...manual, platform: e.target.value })} placeholder="Select" options={data.platforms.map((p) => p.name)} /></Field>
            <Field label="Job link (optional)"><input className="input" value={manual.post_url} onChange={(e) => setManual({ ...manual, post_url: e.target.value })} /></Field>
          </div>
        </Modal>
      )}
    </Card>
  );
}
