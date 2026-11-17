import { useState } from 'react';
import { CheckCircle2, Circle, Clock, XCircle, MinusCircle, AlertTriangle } from 'lucide-react';
import { api, fmtDate } from '../api';
import { Modal, Button, Field, ErrorBox, Badge, toast } from './ui';

export function delayText(hours) {
  if (hours == null) return '';
  if (hours <= 0) return 'on time';
  return hours < 24 ? `${Math.round(hours)}h late` : `${Math.round(hours / 24)}d late`;
}

/** Vertical step tracker for a requirement / candidate / onboarding */
export function StepTracker({ steps, onAction }) {
  const now = new Date();
  return (
    <ol className="relative">
      {steps.map((s, idx) => {
        const i = s.instance;
        const state = i?.state || 'notreached';
        const overdue = state === 'pending' && new Date(i.planned_at.replace(' ', 'T')) < now;
        const Icon = state === 'done' ? CheckCircle2 : state === 'pending' ? (overdue ? AlertTriangle : Clock) : state === 'cancelled' ? XCircle : state === 'skipped' ? MinusCircle : Circle;
        const color = state === 'done' ? 'text-emerald-500' : state === 'pending' ? (overdue ? 'text-rose-500' : 'text-amber-500') : 'text-slate-300';
        return (
          <li key={s.code} className="relative flex gap-3 pb-4 last:pb-0">
            {idx < steps.length - 1 && <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />}
            <Icon className={`relative z-10 mt-0.5 h-6 w-6 shrink-0 bg-white ${color}`} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-400">Step {s.no}</span>
                <span className={`text-sm font-medium ${state === 'notreached' || state === 'cancelled' ? 'text-slate-400' : 'text-slate-800'}`}>{s.name}</span>
                {s.optional ? <Badge color="slate">only if hold</Badge> : null}
                {i?.result && <Badge color={state === 'done' ? (/(reject|not|left|drop)/i.test(i.result) ? 'red' : 'green') : 'slate'}>{i.result}</Badge>}
                {state === 'cancelled' && <Badge>cancelled</Badge>}
              </div>
              <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500">
                <span>Doer: {s.doer_name || s.doer_role}</span>
                {i?.planned_at && <span>Planned: {fmtDate(i.planned_at)}</span>}
                {i?.actual_at && <span>Actual: {fmtDate(i.actual_at)}</span>}
                {state === 'done' && i.delay_hours != null && <span className={i.delay_hours > 0 ? 'text-rose-600' : 'text-emerald-600'}>{delayText(i.delay_hours)}</span>}
                {i?.done_by_name && <span>by {i.done_by_name}</span>}
              </div>
              {i?.remark && <div className="mt-1 rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">{i.remark}</div>}
              {state === 'pending' && onAction && (
                <div className="mt-2">
                  <Button size="sm" variant={overdue ? 'danger' : 'primary'} onClick={() => onAction({ ...i, step_name: s.name, short_name: s.short_name, options: s.options, fields: s.fields, step_code: s.code })}>
                    {overdue ? 'Overdue – update now' : 'Update this step'}
                  </Button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Complete a pending step: pick a result, fill extra fields, add a remark */
export function TaskModal({ task, onClose, onDone, extra }) {
  const [result, setResult] = useState('');
  const [remark, setRemark] = useState('');
  const [data, setData] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  if (!task) return null;

  const submit = async () => {
    if (!result) return setError('Choose a result');
    setSaving(true); setError(null);
    try {
      await api(`/tasks/${task.id}/complete`, { method: 'POST', body: { result, remark, data } });
      toast(`${task.short_name || task.step_name}: ${result}`);
      onDone?.();
      onClose();
    } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={`Step ${task.no || task.step_code?.slice(1)} · ${task.step_name}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={saving} disabled={!result}>Save & move to next step</Button></>}>
      {task.title && (
        <div className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          <div className="font-medium text-slate-800">{task.record_code} · {task.title}</div>
          {task.designation && task.title !== `${task.designation} – ${task.company}` && <div className="text-xs text-slate-500">{task.designation} – {task.company}</div>}
          <div className="text-xs text-slate-500">Planned: {fmtDate(task.planned_at)}</div>
        </div>
      )}
      {extra}
      <div className="label">Result</div>
      <div className="mb-4 flex flex-wrap gap-2">
        {task.options.map((o) => (
          <button key={o.value} onClick={() => setResult(o.value)}
            className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${result === o.value
              ? o.color === 'red' ? 'border-rose-500 bg-rose-50 text-rose-700' : o.color === 'amber' ? 'border-amber-500 bg-amber-50 text-amber-800' : o.color === 'slate' ? 'border-slate-500 bg-slate-100 text-slate-700' : 'border-emerald-500 bg-emerald-50 text-emerald-700'
              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
            {o.label}
          </button>
        ))}
      </div>
      {task.fields?.length > 0 && (
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          {task.fields.map((f) => (
            <Field key={f.key} label={`${f.label}${f.requiredFor && f.requiredFor === result ? ' *' : ''}`}>
              <input className="input" type={f.type} value={data[f.key] || ''} onChange={(e) => setData({ ...data, [f.key]: e.target.value })} />
            </Field>
          ))}
        </div>
      )}
      <Field label="Remark (optional)">
        <textarea className="input" rows={2} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Any note for the team…" />
      </Field>
      <div className="mt-3"><ErrorBox error={error} /></div>
      <p className="mt-3 text-xs text-slate-400">{'Saving stamps the actual time, calculates delay and creates the next step automatically.'}</p>
    </Modal>
  );
}
