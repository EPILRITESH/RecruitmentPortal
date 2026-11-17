import { useMemo, useState } from 'react';
import { api } from '../api';
import { Modal, Button, Field, Select, ErrorBox, toast } from './ui';

export function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim()));
}

const pad = (n) => String(n).padStart(2, '0');
/** Excel cells can be Date objects – turn them into "YYYY-MM-DD" / "HH:MM" / "YYYY-MM-DD HH:MM:SS" (wall clock) */
function cellText(v, kind) {
  if (v == null) return '';
  if (v instanceof Date) {
    const d = `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
    const t = `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    if (kind === 'date') return d;
    if (kind === 'time') return t;
    return `${d} ${t}:${pad(v.getUTCSeconds())}`;
  }
  let s = String(v).trim();
  // 17/11/2026 or 17-11-2026 -> 2026-11-17
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(.*)$/);
  if (m) s = `${m[3]}-${pad(m[2])}-${pad(m[1])}${m[4]}`;
  return s;
}

/**
 * Generic Excel / CSV import with column mapping.
 * fields: [{ key, label, aliases: [], kind?: 'date'|'time'|'datetime', required? }]
 * endpoint: POST path receiving { rows, ...extra } in batches of `batchSize`
 */
export default function SheetImport({ open, onClose, onDone, title, help, fields, endpoint, batchSize = 50, extra = {}, extraFields = null }) {
  const [rows, setRows] = useState([]);
  const [header, setHeader] = useState([]);
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState(null);
  const [result, setResult] = useState(null);

  const load = async (file) => {
    setErr(null); setResult(null);
    try {
      let data;
      if (/\.(csv|txt|dat)$/i.test(file.name)) data = parseCSV(await file.text());
      else { const readXlsxFile = (await import('read-excel-file')).default; data = await readXlsxFile(file); }
      const aliasList = fields.flatMap((f) => f.aliases);
      let hi = data.findIndex((r) => r.some((c) => aliasList.includes(String(c ?? '').trim().toLowerCase())));
      if (hi < 0) hi = 0;
      const h = (data[hi] || []).map((c) => String(c ?? '').trim());
      setHeader(h); setRows(data.slice(hi + 1));
      const m = {};
      for (const f of fields) { const idx = h.findIndex((c) => f.aliases.includes(c.toLowerCase())); if (idx >= 0) m[f.key] = idx; }
      setMap(m);
    } catch (e) { setErr(`Could not read file: ${e.message}`); }
  };

  const mapped = useMemo(() => rows.map((r) => {
    const o = {};
    for (const f of fields) { const idx = map[f.key]; if (idx !== '' && idx != null) o[f.key] = cellText(r[idx], f.kind); }
    return o;
  }).filter((o) => fields.filter((f) => f.required).every((f) => o[f.key])), [rows, map, fields]);

  const go = async () => {
    setBusy(true); setErr(null);
    const sum = {};
    try {
      for (let i = 0; i < mapped.length; i += batchSize) {
        setProgress(`${Math.min(i + batchSize, mapped.length)} / ${mapped.length}`);
        const r = await api(endpoint, { method: 'POST', body: { rows: mapped.slice(i, i + batchSize), ...extra } });
        for (const [k, v] of Object.entries(r)) sum[k] = Array.isArray(v) ? [...(sum[k] || []), ...v] : typeof v === 'number' ? (sum[k] || 0) + v : v;
      }
      setResult(sum); toast('Import finished'); onDone?.();
    } catch (e) { setErr(e.message); } finally { setBusy(false); setProgress(''); }
  };

  return (
    <Modal open={open} onClose={onClose} wide title={title}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={go} loading={busy} disabled={!mapped.length}>{progress ? `Importing ${progress}` : `Import ${mapped.length} rows`}</Button></>}>
      {help && <p className="mb-3 text-sm text-slate-600">{help}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="File (.xlsx / .csv)"><input type="file" accept=".xlsx,.csv,.txt,.dat" className="input" onChange={(e) => e.target.files[0] && load(e.target.files[0])} /></Field>
        {extraFields}
      </div>
      {header.length > 0 && (
        <>
          <div className="label mt-4">Column mapping (auto-detected – change if wrong)</div>
          <div className="grid gap-2 sm:grid-cols-4">
            {fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? ' *' : ''}`}>
                <Select value={map[f.key] ?? ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value === '' ? '' : Number(e.target.value) })} placeholder="— not in file —" options={header.map((h, i) => ({ value: i, label: h || `Column ${i + 1}` }))} />
              </Field>
            ))}
          </div>
          <div className="mt-3 max-h-48 overflow-auto rounded border border-slate-200 text-xs">
            <table className="w-full"><thead><tr>{fields.filter((f) => map[f.key] != null && map[f.key] !== '').map((f) => <th key={f.key} className="th">{f.label}</th>)}</tr></thead>
              <tbody>{mapped.slice(0, 8).map((m, i) => <tr key={i}>{fields.filter((f) => map[f.key] != null && map[f.key] !== '').map((f) => <td key={f.key} className="td">{m[f.key]}</td>)}</tr>)}</tbody></table>
          </div>
        </>
      )}
      {result && <pre className="mt-3 max-h-40 overflow-auto rounded bg-emerald-50 p-2 text-xs text-emerald-900">{JSON.stringify(result, null, 1)}</pre>}
      <div className="mt-3"><ErrorBox error={err} /></div>
    </Modal>
  );
}
