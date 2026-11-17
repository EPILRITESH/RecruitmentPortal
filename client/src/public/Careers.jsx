import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, MapPin, Briefcase } from 'lucide-react';
import { api } from '../api';
import { Button, Field, ErrorBox, Spinner, Modal } from '../components/ui';
import { PublicShell, CANDIDATE_FIELDS } from './Apply';

export default function Careers() {
  const [jobs, setJobs] = useState(null);
  const [company, setCompany] = useState('');
  const [job, setJob] = useState(null);
  const [f, setF] = useState({});
  const [file, setFile] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [params] = useSearchParams();
  const src = params.get('src') || '';
  const jobCode = params.get('job');

  useEffect(() => {
    api('/public/jobs').then(setJobs);
    api('/public/info').then((i) => setCompany(i.company));
    if (jobCode) api(`/public/jobs/${encodeURIComponent(jobCode)}`).then((j) => { setJob(j); setDone(false); }).catch(() => setError('This job is closed'));
  }, [jobCode]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      ['name', 'mobile', ...CANDIDATE_FIELDS.map(([k]) => k)].forEach((k) => f[k] && form.append(k, f[k]));
      if (src) form.append('source', src);
      if (file) form.append('resume', file);
      await api(`/public/jobs/${job.id}/apply`, { method: 'POST', form });
      setDone(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <PublicShell title={`Careers at ${company || 'EPIL Group'}`} subtitle="Current openings – apply in 2 minutes">
      {!jobs ? <Spinner /> : !jobs.length ? <div className="card p-6 text-center text-slate-500">No openings right now. Please check again soon.</div> : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <div key={j.id} className="card flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="font-semibold text-slate-900">{j.designation}</div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
                  <span className="flex items-center gap-1"><Briefcase className="h-3.5 w-3.5" />{j.company}</span>
                  {j.location && <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{j.location}</span>}
                  {j.salary_range && <span>₹ {j.salary_range}</span>}
                  {j.experience && <span>Exp: {j.experience}{/^\d+$/.test(String(j.experience)) ? " yrs" : ""}</span>}
                  {j.openings > 1 && <span>{j.openings} openings</span>}
                </div>
              </div>
              <Button onClick={() => { setJob(j); setDone(false); setF({}); }}>Apply</Button>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!job} onClose={() => setJob(null)} title={`Apply – ${job?.designation}`} wide={!!job?.jd_text}>
        {job?.jd_text && !done && <details className="mb-3 rounded-lg bg-slate-50 p-3 text-sm" open><summary className="cursor-pointer font-medium">Job description</summary><pre className="mt-2 whitespace-pre-wrap font-sans text-slate-700">{job.jd_text}</pre></details>}
        {done ? (
          <div className="py-6 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><p className="mt-3 font-medium">Application received. Our HR team will contact you.</p></div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name *"><input className="input" required value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Mobile number *"><input className="input" required inputMode="numeric" value={f.mobile || ''} onChange={(e) => setF({ ...f, mobile: e.target.value })} /></Field>
            {CANDIDATE_FIELDS.slice(0, 7).map(([k, label, type]) => (
              <Field key={k} label={label}><input className="input" type={type || 'text'} value={f[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
            ))}
            <Field label="Resume (PDF / photo)"><input type="file" className="input" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={(e) => setFile(e.target.files[0])} /></Field>
            <ErrorBox error={error} />
            <Button className="w-full" loading={busy}>Submit application</Button>
          </form>
        )}
      </Modal>
    </PublicShell>
  );
}
