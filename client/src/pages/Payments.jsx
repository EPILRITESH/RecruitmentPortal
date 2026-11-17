import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, fileUrl, fmtDate, inr } from '../api';
import { useApi, Card, PageHeader, Spinner, Button, Modal, Field, Select, ErrorBox, toast, Empty } from '../components/ui';
import { useMasters } from '../components/forms';

export default function Payments() {
  const { data, loading, reload } = useApi('/portal-payments');
  const onb = useApi('/onboardings');
  const { names } = useMasters();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);

  const save = async () => {
    setErr(null);
    try {
      const form = new FormData(); Object.entries(f).forEach(([k, v]) => form.append(k, v)); if (file) form.append('invoice', file);
      await api('/portal-payments', { method: 'POST', form }); toast('Payment added'); setOpen(false); setF({}); reload();
    } catch (e) { setErr(e.message); }
  };

  const total = (data || []).reduce((a, b) => a + b.amount, 0);
  const agency = (onb.data || []).filter((o) => o.agency_payment > 0);
  return (
    <div className="space-y-5">
      <PageHeader title="Payments" subtitle="Job-portal subscriptions and placement-agency fees – feeds the cost-per-hire report." actions={<Button icon={Plus} onClick={() => setOpen(true)}>Add portal payment</Button>} />
      <Card title={`Job portal payments – total ${inr(total)}`} bodyClass="p-0">
        {loading ? <Spinner /> : !data.length ? <Empty /> : (
          <div className="overflow-x-auto"><table className="w-full">
            <thead><tr><th className="th">Platform</th><th className="th">Post / plan</th><th className="th">Posted</th><th className="th">Closed</th><th className="th text-right">Amount</th><th className="th">Invoice</th></tr></thead>
            <tbody>{data.map((p) => (
              <tr key={p.id}><td className="td font-medium">{p.platform}</td><td className="td text-sm">{p.post_name}</td><td className="td text-xs">{fmtDate(p.posted_date, false)}</td><td className="td text-xs">{fmtDate(p.closed_date, false)}</td>
                <td className="td text-right tabular-nums">{inr(p.amount)}</td>
                <td className="td text-xs">{p.invoice ? (/^https?:/.test(p.invoice) ? <a className="link" href={p.invoice} target="_blank" rel="noreferrer">open</a> : /\.\w{3,4}$/.test(p.invoice) && !p.invoice.includes(' ') ? <a className="link" href={fileUrl(p.invoice)} target="_blank" rel="noreferrer">file</a> : p.invoice) : '—'}</td></tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
      <Card title={`Placement agency payments – total ${inr(agency.reduce((a, b) => a + b.agency_payment, 0))}`} bodyClass="p-0">
        {!agency.length ? <Empty text="Recorded at Step 22 of onboarding" /> : (
          <table className="w-full"><thead><tr><th className="th">Joinee</th><th className="th">Source</th><th className="th">Position</th><th className="th">Status</th><th className="th text-right">Amount</th></tr></thead>
            <tbody>{agency.map((o) => <tr key={o.id}><td className="td">{o.name} <span className="text-xs text-slate-400">{o.code}</span></td><td className="td text-xs">{o.source}</td><td className="td text-sm">{o.designation}</td><td className="td text-xs">{o.status}</td><td className="td text-right tabular-nums">{inr(o.agency_payment)}</td></tr>)}</tbody></table>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add job-portal payment" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Platform"><Select value={f.platform || ''} onChange={(e) => setF({ ...f, platform: e.target.value })} placeholder="Select" options={names('source')} /></Field>
          <Field label="Amount (₹)"><input type="number" className="input" value={f.amount || ''} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
          <Field label="Post name / plan" className="sm:col-span-2"><input className="input" value={f.post_name || ''} onChange={(e) => setF({ ...f, post_name: e.target.value })} /></Field>
          <Field label="Posted date"><input type="date" className="input" value={f.posted_date || ''} onChange={(e) => setF({ ...f, posted_date: e.target.value })} /></Field>
          <Field label="Closed / expiry date"><input type="date" className="input" value={f.closed_date || ''} onChange={(e) => setF({ ...f, closed_date: e.target.value })} /></Field>
          <Field label="Invoice file" className="sm:col-span-2"><input type="file" className="input" onChange={(e) => setFile(e.target.files[0])} /></Field>
        </div>
        <div className="mt-3"><ErrorBox error={err} /></div>
      </Modal>
    </div>
  );
}
