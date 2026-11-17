import { useEffect, useState, useCallback } from 'react';
import { X, Loader2, Inbox } from 'lucide-react';
import { api } from '../api';

export function useApi(path, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    if (!path) return;
    setLoading(true);
    api(path).then((d) => { setData(d); setError(null); }).catch((e) => setError(e.message)).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

const BTN = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'bg-rose-600 text-white hover:bg-rose-700',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700',
  whatsapp: 'bg-[#25D366] text-white hover:bg-[#1ebe5b]',
};
export function Button({ variant = 'primary', size = 'md', loading, icon: Icon, children, className = '', ...p }) {
  const sz = size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-sm';
  return (
    <button {...p} disabled={loading || p.disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${sz} ${BTN[variant]} ${className}`}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  );
}

const BADGE = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  blue: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  purple: 'bg-violet-50 text-violet-700 ring-violet-600/20',
};
export function Badge({ color = 'slate', children, className = '' }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[color] || BADGE.slate} ${className}`}>{children}</span>;
}

export const STATUS_COLOR = {
  Active: 'blue', Open: 'blue', Selected: 'green', Joined: 'green', 'Retained 90': 'green', Closed: 'slate', Approved: 'green',
  Rejected: 'red', Dropped: 'slate', Left: 'red', 'Not Joined': 'red', Cancelled: 'slate', 'Future Hold': 'purple', 'On Hold': 'amber',
  'Pre-Onboarding': 'amber', Draft: 'slate', 'Sent for approval': 'amber', Urgent: 'red', High: 'amber', Normal: 'blue', Low: 'slate',
};
export const StatusBadge = ({ value }) => <Badge color={STATUS_COLOR[value] || 'slate'}>{value}</Badge>;

export function Card({ title, actions, children, className = '', bodyClass = 'p-4' }) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }) {
  useEffect(() => {
    if (!open) return;
    const h = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-[6vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h3 className="font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint, className = '' }) {
  return (
    <label className={`block ${className}`}>
      {label && <span className="label">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export function Select({ options = [], placeholder, ...p }) {
  return (
    <select className="input" {...p}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>
);
export const Empty = ({ text = 'Nothing here yet', icon: Icon = Inbox }) => (
  <div className="flex flex-col items-center justify-center gap-2 p-10 text-sm text-slate-400"><Icon className="h-8 w-8" />{text}</div>
);
export const ErrorBox = ({ error }) => error ? <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null;

export function Stat({ label, value, sub, icon: Icon, tone = 'indigo', onClick }) {
  const tones = { indigo: 'bg-indigo-50 text-indigo-600', red: 'bg-rose-50 text-rose-600', green: 'bg-emerald-50 text-emerald-600', amber: 'bg-amber-50 text-amber-600', sky: 'bg-sky-50 text-sky-600', violet: 'bg-violet-50 text-violet-600' };
  return (
    <div onClick={onClick} className={`card flex items-center gap-3 p-4 ${onClick ? 'cursor-pointer transition hover:border-indigo-300' : ''}`}>
      {Icon && <div className={`rounded-lg p-2.5 ${tones[tone]}`}><Icon className="h-5 w-5" /></div>}
      <div className="min-w-0">
        <div className="text-2xl font-semibold tabular-nums text-slate-900">{value ?? '—'}</div>
        <div className="truncate text-xs text-slate-500">{label}</div>
        {sub && <div className="text-xs text-slate-400">{sub}</div>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1">
      {tabs.map((t) => (
        <button key={t.value} onClick={() => onChange(t.value)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${value === t.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
          {t.label}{t.count != null && <span className={`ml-1.5 rounded-full px-1.5 text-xs ${t.danger && t.count ? 'bg-rose-100 text-rose-700' : 'bg-slate-200 text-slate-600'}`}>{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

let toastFn = null;
export function toast(msg, type = 'ok') { toastFn?.(msg, type); }
export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    toastFn = (msg, type) => {
      const id = Math.random();
      setItems((x) => [...x, { id, msg, type }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3500);
    };
    return () => { toastFn = null; };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2.5 text-sm text-white shadow-lg ${t.type === 'error' ? 'bg-rose-600' : 'bg-slate-900'}`}>{t.msg}</div>
      ))}
    </div>
  );
}
