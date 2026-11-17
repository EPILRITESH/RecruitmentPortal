import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { Button, Field, ErrorBox, Spinner } from '../components/ui';

export function PublicShell({ children, title, subtitle }) {
  return (
    <div className="min-h-full bg-gradient-to-b from-indigo-50 to-slate-50 px-4 py-8">
      <div className="mx-auto max-w-xl">
        <div className="mb-5 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-600 font-bold text-white">R</div>
          <div><div className="font-semibold text-slate-900">{title}</div>{subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export const CANDIDATE_FIELDS = [
  ['email', 'Email', 'email'], ['qualification', 'Highest qualification'], ['experience_years', 'Total experience (years)', 'number'],
  ['current_company', 'Current / last company'], ['current_ctc', 'Current monthly salary (₹)'], ['expected_ctc', 'Expected monthly salary (₹)'],
  ['notice_period', 'Notice period / when can you join?'], ['location', 'Where do you stay? (area, city)'], ['skills', 'Key skills'],
];

export default function Apply() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => { api(`/public/apply/${token}`).then((d) => { setInfo(d); setF(d); }).catch((e) => setError(e.message)); }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      CANDIDATE_FIELDS.forEach(([k]) => f[k] != null && form.append(k, f[k]));
      if (file) form.append('resume', file);
      await api(`/public/apply/${token}`, { method: 'POST', form });
      setDone(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (error && !info) return <PublicShell title="Application form"><ErrorBox error={error} /></PublicShell>;
  if (!info) return <Spinner />;
  return (
    <PublicShell title={`Application – ${info.designation || 'Job opening'}`} subtitle={info.company}>
      {done ? (
        <div className="card p-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><h2 className="mt-3 text-lg font-semibold">Thank you, {info.name}!</h2><p className="mt-1 text-sm text-slate-500">Your details are received. Our HR team will call you for the interview.</p></div>
      ) : (
        <form onSubmit={submit} className="card space-y-3 p-5">
          <p className="text-sm text-slate-600">Hello <b>{info.name}</b>, please complete your details for <b>{info.designation}</b>{info.salary_range ? ` (₹${info.salary_range})` : ''}. It takes 2 minutes.</p>
          {CANDIDATE_FIELDS.map(([k, label, type]) => (
            <Field key={k} label={label}><input className="input" type={type || 'text'} value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
          ))}
          <Field label={info.has_resume ? 'Resume (already received – upload again to replace)' : 'Upload your resume (PDF / photo) *'}>
            <input type="file" className="input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required={!info.has_resume} onChange={(e) => setFile(e.target.files[0])} />
          </Field>
          <ErrorBox error={error} />
          <Button className="w-full" loading={busy}>Submit</Button>
        </form>
      )}
    </PublicShell>
  );
}
