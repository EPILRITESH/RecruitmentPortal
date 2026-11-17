import { useEffect, useState } from 'react';
import { MessageCircle, Mail, Sparkles } from 'lucide-react';
import { api } from '../api';
import { Modal, Button, Field, Select, ErrorBox, Tabs, toast } from './ui';

export default function MessageModal({ candidate, open, onClose, onSent, defaultTemplate, defaultChannel }) {
  const [channel, setChannel] = useState(defaultChannel || 'whatsapp');
  const [templates, setTemplates] = useState([]);
  const [template, setTemplate] = useState(defaultTemplate || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { if (open) api('/templates').then(setTemplates); }, [open]);
  useEffect(() => { if (open) setTo(channel === 'email' ? candidate?.email || '' : candidate?.mobile || ''); }, [open, channel, candidate]);
  useEffect(() => {
    if (!open || !template) return;
    api(`/candidates/${candidate.id}/preview-template?template=${template}`).then((p) => {
      setBody(p.body); setSubject(p.subject || '');
      if (p.channel) setChannel(p.channel);
    });
  }, [template, open, candidate]);

  const aiDraft = async () => {
    setAiBusy(true);
    try {
      const purpose = prompt('What should the message say? (e.g. "Invite for interview tomorrow 11am", "Ask for updated resume")');
      if (!purpose) return;
      const r = await api('/ai/draft-message', { method: 'POST', body: { purpose, channel, candidate_id: candidate.id } });
      setBody(r.body); if (r.subject) setSubject(r.subject);
    } catch (e) { setError(e.message); } finally { setAiBusy(false); }
  };

  const send = async () => {
    setBusy(true); setError(null);
    try {
      const r = await api(`/candidates/${candidate.id}/message`, { method: 'POST', body: { channel, template, body, subject, to } });
      if (r.link) window.open(r.link, '_blank');
      else if (r.mailto) window.location.href = r.mailto;
      toast(r.status === 'sent' ? 'Message sent' : r.link ? 'WhatsApp opened – press send' : r.error || 'Logged');
      onSent?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const list = templates.filter((t) => t.channel === channel);
  return (
    <Modal open={open} onClose={onClose} title={`Message ${candidate?.name || ''}`} wide
      footer={<>
        <Button variant="ghost" icon={Sparkles} onClick={aiDraft} loading={aiBusy}>AI draft</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant={channel === 'whatsapp' ? 'whatsapp' : 'primary'} icon={channel === 'whatsapp' ? MessageCircle : Mail} onClick={send} loading={busy} disabled={!body}>
          {channel === 'whatsapp' ? 'Send on WhatsApp' : 'Send Email'}
        </Button>
      </>}>
      <div className="mb-4"><Tabs value={channel} onChange={(v) => { setChannel(v); setTemplate(''); }} tabs={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'Email' }]} /></div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Template"><Select value={template} onChange={(e) => setTemplate(e.target.value)} placeholder="— write your own —" options={list.map((t) => ({ value: t.key, label: t.name }))} /></Field>
        <Field label={channel === 'email' ? 'To (email)' : 'To (mobile)'}><input className="input" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {channel === 'email' && <Field label="Subject" className="mt-3"><input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>}
      <Field label="Message" className="mt-3"><textarea className="input font-mono text-[13px]" rows={8} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <p className="mt-2 text-xs text-slate-400">Text in [brackets] means the value is missing – edit before sending.</p>
      <div className="mt-2"><ErrorBox error={error} /></div>
    </Modal>
  );
}
