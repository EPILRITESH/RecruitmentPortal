import { useEffect, useMemo, useState } from 'react';
import { FileSpreadsheet, Upload, Sparkles } from 'lucide-react';
import { api } from '../api';
import { Modal, Button, Field, Select, ErrorBox, toast } from './ui';
import { useMasters } from './forms';

// Column names used by Apna / Work India / Naukri exports → portal fields
const ALIASES = {
  name: ['name', 'candidate name', 'full name', 'candidate', 'applicant name'],
  mobile: ['mobile', 'mobile no', 'mobile number', 'phone', 'phone number', 'contact', 'contact number', 'whatsapp'],
  email: ['email', 'email id', 'email address', 'e-mail'],
  experience_years: ['experience', 'total experience', 'exp', 'experience (years)', 'years of experience'],
  current_ctc: ['current salary', 'current ctc', 'salary', 'ctc'],
  expected_ctc: ['expected salary', 'expected ctc'],
  location: ['location', 'city', 'current location', 'area', 'address'],
  qualification: ['qualification', 'education', 'highest qualification', 'degree'],
  skills: ['skills', 'key skills'],
  current_company: ['current company', 'company', 'last company', 'employer'],
  notice_period: ['notice period', 'notice'],
  resume_url: ['resume', 'resume link', 'cv', 'cv link'],
};
const FIELDS = Object.keys(ALIASES);

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

function useOpenRequirements(open) {
  const [reqs, setReqs] = useState([]);
  useEffect(() => { if (open) api('/requirements?status=Open').then(setReqs); }, [open]);
  return reqs;
}

export function ImportModal({ open, onClose, onDone }) {
  const { names } = useMasters();
  const reqs = useOpenRequirements(open);
  const [rows, setRows] = useState([]);
  const [header, setHeader] = useState([]);
  const [map, setMap] = useState({});
  const [reqId, setReqId] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState(null);

  const load = async (file) => {
    setErr(null);
    try {
      let data;
      if (/\.csv$/i.test(file.name)) data = parseCSV(await file.text());
      else { const readXlsxFile = (await import('read-excel-file')).default; data = await readXlsxFile(file); }
      const hi = data.findIndex((r) => r.some((c) => /name/i.test(String(c ?? ''))));
      const h = (data[hi >= 0 ? hi : 0] || []).map((c) => String(c ?? '').trim());
      setHeader(h);
      setRows(data.slice((hi >= 0 ? hi : 0) + 1));
      const m = {};
      for (const f of FIELDS) {
        const idx = h.findIndex((c) => ALIASES[f].includes(c.toLowerCase()));
        if (idx >= 0) m[f] = idx;
      }
      setMap(m);
    } catch (e) { setErr(`Could not read file: ${e.message}`); }
  };

  const mapped = useMemo(() => rows.map((r) => {
    const o = {};
    for (const [f, idx] of Object.entries(map)) if (idx !== '' && idx != null) o[f] = r[idx] == null ? '' : String(r[idx]).trim();
    return o;
  }).filter((o) => o.name || o.mobile), [rows, map]);

  const run = async () => {
    if (!source) return setErr('Select the platform these candidates came from');
    setBusy(true); setErr(null);
    const total = { created: 0, duplicates: 0, errors: [] };
    try {
      for (let i = 0; i < mapped.length; i += 25) {
        setProgress(`${Math.min(i + 25, mapped.length)} / ${mapped.length}`);
        const r = await api('/candidates/bulk-import', { method: 'POST', body: { rows: mapped.slice(i, i + 25), requirement_id: reqId || null, source } });
        total.created += r.created; total.duplicates += r.duplicates;
        total.errors.push(...r.errors.map((e) => ({ ...e, row: e.row + i })));
      }
      toast(`${total.created} imported, ${total.duplicates} duplicates skipped`);
      if (total.errors.length) setErr(`${total.errors.length} rows skipped: ${total.errors.slice(0, 5).map((e) => `row ${e.row} – ${e.error}`).join('; ')}`);
      else { onDone?.(); onClose(); }
    } catch (e) { setErr(e.message); } finally { setBusy(false); setProgress(null); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Import candidates from Excel / CSV"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={run} loading={busy} disabled={!mapped.length}>{progress ? `Importing ${progress}` : `Import ${mapped.length} candidates`}</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Download the applicants list from Apna / Work India / Naukri / LinkedIn as Excel or CSV and upload it here. Duplicates (same mobile + same job) are skipped and every new candidate gets screened automatically.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="File (.xlsx / .csv)"><input type="file" accept=".xlsx,.csv" className="input" onChange={(e) => e.target.files[0] && load(e.target.files[0])} /></Field>
        <Field label="Platform (source) *"><Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="Select" options={names('source')} /></Field>
        <Field label="For requirement"><Select value={reqId} onChange={(e) => setReqId(e.target.value)} placeholder="General pool" options={reqs.map((r) => ({ value: r.id, label: `${r.code} · ${r.designation}` }))} /></Field>
      </div>
      {header.length > 0 && (
        <>
          <div className="mt-4 label">Column mapping</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <Field key={f} label={f.replace('_', ' ')}>
                <Select value={map[f] ?? ''} onChange={(e) => setMap({ ...map, [f]: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="— not in file —" options={header.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))} />
              </Field>
            ))}
          </div>
          <div className="mt-3 max-h-48 overflow-auto rounded border border-slate-200 text-xs">
            <table className="w-full"><thead><tr><th className="th">Name</th><th className="th">Mobile</th><th className="th">Email</th><th className="th">Location</th></tr></thead>
              <tbody>{mapped.slice(0, 8).map((m, i) => <tr key={i}><td className="td">{m.name}</td><td className="td">{m.mobile}</td><td className="td">{m.email}</td><td className="td">{m.location}</td></tr>)}</tbody></table>
          </div>
        </>
      )}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}

export function ResumeBulkModal({ open, onClose, onDone }) {
  const { names } = useMasters();
  const reqs = useOpenRequirements(open);
  const [files, setFiles] = useState([]);
  const [reqId, setReqId] = useState('');
  const [source, setSource] = useState('');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setLog([]);
    for (const f of files) {
      try {
        const form = new FormData(); form.append('resume', f);
        const p = await api('/candidates/parse-cv', { method: 'POST', form });
        if (!p.name || String(p.mobile || '').replace(/\D/g, '').length < 10) { setLog((l) => [...l, `✗ ${f.name}: name/mobile not found – add manually`]); continue; }
        const c = new FormData();
        for (const [k, v] of Object.entries({ ...p, skills: (p.skills || []).join(', '), resume_text: p.summary, source, requirement_id: reqId, channel: 'resume-bulk' })) if (v != null && v !== '' && !k.startsWith('_')) c.append(k, v);
        c.append('resume', f);
        const r = await api('/candidates', { method: 'POST', form: c });
        setLog((l) => [...l, `✓ ${f.name}: ${p.name} → ${r.code}`]);
      } catch (e) { setLog((l) => [...l, `✗ ${f.name}: ${e.message}`]); }
    }
    setBusy(false); onDone?.();
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Upload many resumes"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button icon={Sparkles} onClick={run} loading={busy} disabled={!files.length || !source}>Read & add {files.length} resumes</Button></>}>
      <p className="mb-3 text-sm text-slate-600">Select many resumes (PDF / photo). The CV Parser reads each one, creates the candidate and screening runs automatically. Works best with the AI key set in Settings.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Resumes"><input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.txt" className="input" onChange={(e) => setFiles([...e.target.files])} /></Field>
        <Field label="Platform (source) *"><Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="Select" options={names('source')} /></Field>
        <Field label="For requirement"><Select value={reqId} onChange={(e) => setReqId(e.target.value)} placeholder="General pool" options={reqs.map((r) => ({ value: r.id, label: `${r.code} · ${r.designation}` }))} /></Field>
      </div>
      {log.length > 0 && <pre className="mt-3 max-h-56 overflow-auto rounded bg-slate-50 p-2 text-xs">{log.join('\n')}</pre>}
    </Modal>
  );
}

/** Sticky bar shown when candidates are ticked */
export function BulkBar({ ids, onClear, onDone }) {
  const [busy, setBusy] = useState(null);
  const [progress, setProgress] = useState('');
  const screen = async () => {
    setBusy('screen');
    for (let i = 0; i < ids.length; i++) {
      setProgress(`${i + 1}/${ids.length}`);
      try { await api(`/candidates/${ids[i]}/screen`, { method: 'POST' }); } catch { /* keep going */ }
    }
    toast(`Screening done for ${ids.length} candidates`);
    setBusy(null); setProgress(''); onDone();
  };
  const action = async (result) => {
    if (!window.confirm(`Mark Step 4 Screening = ${result} for ${ids.length} candidates?`)) return;
    setBusy(result);
    try {
      const r = await api('/candidates/bulk-action', { method: 'POST', body: { ids, step: 'S04', result } });
      toast(`${r.done} updated${r.skipped ? `, ${r.skipped} not at screening step` : ''}`);
      onDone();
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(null); }
  };
  if (!ids.length) return null;
  return (
    <div className="sticky top-0 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm shadow-sm">
      <b>{ids.length} selected</b>
      <Button size="sm" icon={Sparkles} onClick={screen} loading={busy === 'screen'}>{progress ? `Screening ${progress}` : 'Run screening'}</Button>
      <Button size="sm" variant="success" onClick={() => action('Accepted')} loading={busy === 'Accepted'}>Accept (Step 4)</Button>
      <Button size="sm" variant="secondary" className="!text-rose-600" onClick={() => action('Rejected')} loading={busy === 'Rejected'}>Reject (Step 4)</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </div>
  );
}

export const BulkIcons = { FileSpreadsheet, Upload };
