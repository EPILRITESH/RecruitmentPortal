import { useEffect, useState } from 'react';
import { Sparkles, Upload, AlertTriangle } from 'lucide-react';
import { api } from '../api';
import { Modal, Button, Field, Select, ErrorBox, toast } from './ui';

let mastersCache = null;
export function useMasters() {
  const [m, setM] = useState(mastersCache || {});
  useEffect(() => { api('/masters').then((x) => { mastersCache = x; setM(x); }); }, []);
  const names = (type) => (m[type] || []).map((x) => x.name);
  return { masters: m, names };
}

export function RequirementForm({ open, onClose, onSaved, initial }) {
  const { names } = useMasters();
  const [f, setF] = useState({ priority: 'Normal', openings: 1, request_date: new Date().toISOString().slice(0, 10), ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = initial?.id ? await api(`/requirements/${initial.id}`, { method: 'PUT', body: f }) : await api('/requirements', { method: 'POST', body: f });
      toast(initial?.id ? 'Requirement updated' : `Requirement ${r.code} created – JD task assigned`);
      onSaved?.(r); onClose();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={initial?.id ? 'Edit requirement' : 'New requirement (Inward)'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>{initial?.id ? 'Save' : 'Create requirement'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Date *"><input type="date" className="input" value={f.request_date || ''} onChange={set('request_date')} /></Field>
        <Field label="Company *"><Select value={f.company || ''} onChange={set('company')} placeholder="Select company" options={names('company')} /></Field>
        <Field label="Designation *">
          <input className="input" list="dl-designation" value={f.designation || ''} onChange={set('designation')} placeholder="e.g. Accountant" />
          <datalist id="dl-designation">{names('designation').map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="Department"><Select value={f.department || ''} onChange={set('department')} placeholder="—" options={names('department')} /></Field>
        <Field label="Salary range *"><input className="input" value={f.salary_range || ''} onChange={set('salary_range')} placeholder="e.g. 20000 to 25000" /></Field>
        <Field label="Requirement by *">
          <input className="input" list="dl-requester" value={f.requirement_by || ''} onChange={set('requirement_by')} placeholder="e.g. RITESH SIR" />
          <datalist id="dl-requester">{names('requester').map((d) => <option key={d} value={d} />)}</datalist>
        </Field>
        <Field label="No. of openings"><input type="number" min="1" className="input" value={f.openings} onChange={set('openings')} /></Field>
        <Field label="Priority"><Select value={f.priority} onChange={set('priority')} options={['Urgent', 'High', 'Normal', 'Low']} /></Field>
        <Field label="Experience"><input className="input" value={f.experience || ''} onChange={set('experience')} placeholder="e.g. 2-4 years / Fresher" /></Field>
        <Field label="Qualification"><input className="input" value={f.qualification || ''} onChange={set('qualification')} placeholder="e.g. B.Com" /></Field>
        <Field label="Job location"><input className="input" value={f.location || ''} onChange={set('location')} placeholder="e.g. Kosamba, Surat" /></Field>
        <Field label="Target closing date"><input type="date" className="input" value={f.target_date || ''} onChange={set('target_date')} /></Field>
        <Field label="Key skills" className="sm:col-span-2"><input className="input" value={f.skills || ''} onChange={set('skills')} placeholder="Comma separated – used by the AI JD & screening agents" /></Field>
        <Field label="Notes for recruiter" className="sm:col-span-2"><textarea className="input" rows={2} value={f.notes || ''} onChange={set('notes')} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}

export function CandidateForm({ open, onClose, onSaved, requirementId }) {
  const { names, masters } = useMasters();
  const [reqs, setReqs] = useState([]);
  const [f, setF] = useState({ requirement_id: requirementId || '' });
  const [file, setFile] = useState(null);
  const [dups, setDups] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [parsedNote, setParsedNote] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => { if (open) api('/requirements?status=Open').then(setReqs); }, [open]);
  useEffect(() => {
    const m = String(f.mobile || '').replace(/\D/g, '');
    if (m.length < 10) return setDups([]);
    const t = setTimeout(() => api(`/candidates/check-duplicate?mobile=${m}`).then(setDups), 300);
    return () => clearTimeout(t);
  }, [f.mobile]);
  useEffect(() => {
    const src = (masters.source || []).find((s) => s.name === f.source);
    if (src?.email) setF((x) => ({ ...x, consultancy_email: src.email }));
  }, [f.source, masters]);

  const parse = async (fl) => {
    setFile(fl);
    if (!fl) return;
    setParsing(true); setParsedNote(null);
    try {
      const form = new FormData(); form.append('resume', fl);
      const p = await api('/candidates/parse-cv', { method: 'POST', form });
      setF((x) => ({
        ...x, name: p.name || x.name, mobile: p.mobile || x.mobile, email: p.email || x.email, current_company: p.current_company || x.current_company,
        experience_years: p.experience_years || x.experience_years, current_ctc: p.current_ctc || x.current_ctc, expected_ctc: p.expected_ctc || x.expected_ctc,
        notice_period: p.notice_period || x.notice_period, location: p.location || x.location, qualification: p.qualification || x.qualification,
        skills: p.skills?.length ? p.skills.join(', ') : x.skills, resume_text: p.summary,
      }));
      setParsedNote(p._mode === 'claude' ? '✨ Details filled by the AI CV Parser – please check.' : p.summary);
    } catch (e) { setParsedNote(e.message); } finally { setParsing(false); }
  };

  const save = async (force) => {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      Object.entries(f).forEach(([k, v]) => v != null && v !== '' && form.append(k, v));
      if (file) form.append('resume', file);
      if (force) form.append('force', '1');
      const r = await api('/candidates', { method: 'POST', form });
      toast(`${r.code} added – screening task created`);
      onSaved?.(r); onClose();
      setF({ requirement_id: requirementId || '' }); setFile(null);
    } catch (e) {
      if (e.status === 409 && window.confirm(`${e.message}\n\nAdd anyway?`)) return save(true);
      setError(e.message);
    } finally { setBusy(false); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Add candidate (Outward)"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => save(false)} loading={busy}>Add candidate</Button></>}>
      <label className="mb-4 flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 p-4 hover:border-indigo-400">
        {parsing ? <Sparkles className="h-6 w-6 animate-pulse text-indigo-500" /> : <Upload className="h-6 w-6 text-indigo-500" />}
        <div className="text-sm">
          <div className="font-medium text-slate-800">{file ? file.name : 'Upload resume (PDF / image) – AI fills the form'}</div>
          <div className="text-xs text-slate-500">{parsing ? 'Reading resume…' : parsedNote || 'Optional. You can also type the details below.'}</div>
        </div>
        <input type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.doc,.docx" className="hidden" onChange={(e) => parse(e.target.files[0])} />
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Requirement (Inward)" className="sm:col-span-2">
          <Select value={f.requirement_id} onChange={set('requirement_id')} placeholder="— General pool —" options={reqs.map((r) => ({ value: r.id, label: `${r.code} · ${r.designation} – ${r.company}` }))} />
        </Field>
        <Field label="Name *"><input className="input" value={f.name || ''} onChange={set('name')} /></Field>
        <Field label="Mobile *"><input className="input" value={f.mobile || ''} onChange={set('mobile')} inputMode="numeric" /></Field>
        {dups.length > 0 && (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800 sm:col-span-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <div>Already in database: {dups.map((d) => `${d.code} (${d.designation || 'pool'} – ${d.status})`).join(', ')}</div>
          </div>
        )}
        <Field label="Candidate from (source) *">
          <Select value={f.source || ''} onChange={set('source')} placeholder="Select source" options={names('source')} />
        </Field>
        <Field label="Consultancy email"><input className="input" value={f.consultancy_email || ''} onChange={set('consultancy_email')} /></Field>
        <Field label="Email"><input className="input" value={f.email || ''} onChange={set('email')} /></Field>
        <Field label="Current company"><input className="input" value={f.current_company || ''} onChange={set('current_company')} /></Field>
        <Field label="Experience (years)"><input className="input" type="number" step="0.5" value={f.experience_years || ''} onChange={set('experience_years')} /></Field>
        <Field label="Qualification"><input className="input" value={f.qualification || ''} onChange={set('qualification')} /></Field>
        <Field label="Current salary"><input className="input" value={f.current_ctc || ''} onChange={set('current_ctc')} /></Field>
        <Field label="Expected salary"><input className="input" value={f.expected_ctc || ''} onChange={set('expected_ctc')} /></Field>
        <Field label="Notice period"><input className="input" value={f.notice_period || ''} onChange={set('notice_period')} /></Field>
        <Field label="Location"><input className="input" value={f.location || ''} onChange={set('location')} /></Field>
        <Field label="Skills" className="sm:col-span-2"><input className="input" value={f.skills || ''} onChange={set('skills')} /></Field>
        <Field label="Resume link (Drive etc.)" className="sm:col-span-2"><input className="input" value={f.resume_url || ''} onChange={set('resume_url')} /></Field>
      </div>
      <div className="mt-3"><ErrorBox error={error} /></div>
    </Modal>
  );
}
