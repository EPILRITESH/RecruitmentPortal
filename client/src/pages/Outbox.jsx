import { useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Mail, Send, RotateCw, X } from 'lucide-react';
import { api, auth, fmtDate } from '../api';
import { useApi, PageHeader, Tabs, Spinner, Empty, Badge, Button, toast } from '../components/ui';

const COLOR = { sent: 'green', 'sent-manual': 'green', queued: 'amber', failed: 'red', 'opened-link': 'blue', skipped: 'slate' };

export default function Outbox() {
  const [status, setStatus] = useState('queued');
  const { data, loading, reload } = useApi(`/outbox?status=${status}`, [status]);
  const [busy, setBusy] = useState(null);
  const [runner, setRunner] = useState(null); // one-by-one WhatsApp sending
  const count = (s) => data?.counts.find((c) => c.status === s)?.n || 0;

  const openAndMark = async (m) => {
    window.open(m.link, '_blank');
    await api(`/outbox/${m.id}/sent`, { method: 'POST' });
    toast('Marked as sent'); reload();
  };
  const retry = async (m) => {
    setBusy(m.id);
    const r = await api(`/outbox/${m.id}/retry`, { method: 'POST' });
    toast(r.status === 'sent' ? 'Sent' : r.error || 'Provider not configured – use the send button');
    setBusy(null); reload();
  };
  const skip = async (m) => { await api(`/outbox/${m.id}/skip`, { method: 'POST' }); reload(); };

  return (
    <div>
      <PageHeader title="Outbox – WhatsApp & Email" subtitle="Every automatic message lands here. With WhatsApp Cloud API / email provider set (Settings → Communication) they go out by themselves; otherwise send each one with one click." />
      {data && (!data.email_ready || !data.whatsapp_ready) && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {!data.whatsapp_ready && 'WhatsApp is in click-to-send mode. '}{!data.email_ready && 'Email provider is not set. '}
          {auth.user?.role === 'admin' ? <Link className="underline" to="/settings">Connect them in Settings → Communication</Link> : 'Ask the admin to connect them in Settings.'} to send fully automatically.
        </div>
      )}
      {status === 'queued' && data?.rows.some((m) => m.channel === 'whatsapp' && m.link) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          <span><b>{data.rows.filter((m) => m.channel === 'whatsapp' && m.link).length}</b> WhatsApp messages waiting.</span>
          <Button size="sm" variant="whatsapp" icon={Send} onClick={() => setRunner({ list: data.rows.filter((m) => m.channel === 'whatsapp' && m.link), i: 0 })}>Send all one by one</Button>
        </div>
      )}
      {runner && runner.list[runner.i] && (() => {
        const m = runner.list[runner.i];
        const next = async (sent) => {
          if (sent) { window.open(m.link, '_blank'); await api(`/outbox/${m.id}/sent`, { method: 'POST' }); } else await api(`/outbox/${m.id}/skip`, { method: 'POST' });
          if (runner.i + 1 >= runner.list.length) { setRunner(null); toast('All done'); reload(); } else setRunner({ ...runner, i: runner.i + 1 });
        };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
            <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
              <div className="mb-1 text-xs text-slate-500">Message {runner.i + 1} of {runner.list.length}</div>
              <div className="font-semibold">{m.candidate_name || m.to_addr} <span className="text-sm font-normal text-slate-500">+{m.to_addr}</span></div>
              <div className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#e7fbe6] p-3 text-sm text-slate-800">{m.body}</div>
              <p className="mt-2 text-xs text-slate-500">Click the green button → WhatsApp opens with this message → press send there → come back for the next one.</p>
              <div className="mt-4 flex justify-between gap-2">
                <Button variant="ghost" onClick={() => { setRunner(null); reload(); }}>Stop</Button>
                <div className="flex gap-2"><Button variant="secondary" onClick={() => next(false)}>Skip</Button><Button variant="whatsapp" icon={Send} onClick={() => next(true)}>Open WhatsApp & next</Button></div>
              </div>
            </div>
          </div>
        );
      })()}
      <div className="mb-4"><Tabs value={status} onChange={setStatus} tabs={[
        { value: 'queued', label: 'To send', count: count('queued'), danger: true }, { value: 'failed', label: 'Failed', count: count('failed') },
        { value: 'sent', label: 'Sent (auto)', count: count('sent') }, { value: 'sent-manual', label: 'Sent (manual)', count: count('sent-manual') }, { value: 'all', label: 'All' }]} /></div>
      {loading && !data ? <Spinner /> : !data.rows.length ? <Empty text="Nothing here" /> : (
        <div className="space-y-2">
          {data.rows.map((m) => (
            <div key={m.id} className="card flex flex-col gap-2 p-3 sm:flex-row sm:items-start">
              <div className="mt-0.5">{m.channel === 'whatsapp' ? <MessageCircle className="h-5 w-5 text-[#1ebe5b]" /> : <Mail className="h-5 w-5 text-sky-600" />}</div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge color={COLOR[m.status]}>{m.status}</Badge>
                  <span className="font-medium">{m.to_addr}</span>
                  {m.candidate_id && <Link className="link text-xs" to={`/candidates/${m.candidate_id}`}>{m.candidate_code} {m.candidate_name}</Link>}
                  {m.automation_name && <Badge color="indigo">auto: {m.automation_name}</Badge>}
                  <span className="text-xs text-slate-400">{fmtDate(m.created_at)}</span>
                </div>
                {m.subject && <div className="mt-1 text-sm font-medium">{m.subject}</div>}
                <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-sm text-slate-600">{m.body}</div>
                {m.error && m.status !== 'queued' && <div className="mt-1 text-xs text-rose-600">{m.error}</div>}
              </div>
              {['queued', 'failed'].includes(m.status) && (
                <div className="flex shrink-0 gap-1.5">
                  {m.link && <Button size="sm" variant={m.channel === 'whatsapp' ? 'whatsapp' : 'primary'} icon={Send} onClick={() => openAndMark(m)}>Send</Button>}
                  <Button size="sm" variant="secondary" icon={RotateCw} loading={busy === m.id} onClick={() => retry(m)}>Retry auto</Button>
                  <Button size="sm" variant="ghost" icon={X} onClick={() => skip(m)}>Skip</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
