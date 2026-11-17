import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { fmtDate, inr } from '../api';
import { useApi, Card, Spinner, Tabs, Select, Modal, Badge, StatusBadge, Empty } from '../components/ui';
import { useMasters } from '../components/forms';

const iso = (d) => d.toISOString().slice(0, 10);
function weekStart(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; }
function isoWeekNo(monday) { const th = new Date(monday); th.setUTCDate(monday.getUTCDate() + 3); const ys = new Date(Date.UTC(th.getUTCFullYear(), 0, 1)); return Math.ceil(((th - ys) / 864e5 + 1) / 7); }
const ddmmyy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCFullYear()).slice(2)}`;

function lastWeeks(n = 16) {
  const out = [];
  let m = weekStart(new Date());
  for (let i = 0; i < n; i++) {
    const sun = new Date(m); sun.setUTCDate(m.getUTCDate() + 6);
    out.push({ value: `${iso(m)}|${iso(sun)}`, label: `WEEK-${isoWeekNo(m)} (${ddmmyy(m)} to ${ddmmyy(sun)})` });
    m = new Date(m); m.setUTCDate(m.getUTCDate() - 7);
  }
  return out;
}
function lastMonths(n = 12) {
  const out = []; const d = new Date();
  for (let i = 0; i < n; i++) {
    const a = new Date(Date.UTC(d.getFullYear(), d.getMonth() - i, 1));
    const b = new Date(Date.UTC(d.getFullYear(), d.getMonth() - i + 1, 0));
    out.push({ value: `${iso(a)}|${iso(b)}`, label: a.toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }) });
  }
  return out;
}
const periodRange = (p, group) => {
  if (group === 'month') { const [y, m] = p.key.split('-').map(Number); return [iso(new Date(Date.UTC(y, m - 1, 1))), iso(new Date(Date.UTC(y, m, 0)))]; }
  const s = new Date(`${p.start}T00:00:00Z`); const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6); return [iso(s), iso(e)];
};

function Score({ label, value, plan, onClick, tone = 'indigo' }) {
  const pct = plan ? Math.round((value / plan) * 100) : null;
  const tones = { indigo: 'border-t-indigo-500', sky: 'border-t-sky-500', green: 'border-t-emerald-500', amber: 'border-t-amber-500', violet: 'border-t-violet-500', rose: 'border-t-rose-500' };
  return (
    <button onClick={onClick} className={`card border-t-4 p-3 text-left transition hover:shadow-md ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value ?? 0}</div>
      {plan != null && <div className="mt-0.5 text-xs text-slate-500">Plan {plan} · <span className={pct >= 90 ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-rose-600'}>{pct ?? '–'}%</span></div>}
    </button>
  );
}

function NamesModal({ q, onClose }) {
  const { data, loading } = useApi(q ? `/mis/list?${new URLSearchParams(q.params)}` : null, [q]);
  const [s, setS] = useState('');
  if (!q) return null;
  const rows = (data || []).filter((r) => !s || `${r.name} ${r.code} ${r.source}`.toLowerCase().includes(s.toLowerCase()));
  return (
    <Modal open wide onClose={onClose} title={`${q.title} – ${data ? data.length : '…'} names`}>
      <input className="input mb-3" placeholder="Search…" value={s} onChange={(e) => setS(e.target.value)} />
      {loading ? <Spinner /> : !rows.length ? <Empty /> : (
        <table className="w-full text-sm">
          <thead><tr><th className="th">ID</th><th className="th">Name</th><th className="th">Platform</th><th className="th">Position</th><th className="th">Date</th><th className="th">Result</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={`${r.et}-${r.id}-${i}`}>
              <td className="td"><Link className="link" to={`/${r.et === 'requirement' ? 'requirements' : r.et === 'candidate' ? 'candidates' : 'onboarding'}/${r.id}`} onClick={onClose}>{r.code}</Link></td>
              <td className="td font-medium">{r.name}</td><td className="td text-xs">{r.source}</td>
              <td className="td text-xs">{r.designation}<div className="text-slate-400">{r.company}</div></td>
              <td className="td whitespace-nowrap text-xs">{fmtDate(r.date)}</td><td className="td text-xs">{r.status || r.state}</td>
            </tr>))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}

export default function MIS() {
  const { names } = useMasters();
  const weeks = useMemo(() => lastWeeks(), []);
  const months = useMemo(() => lastMonths(), []);
  const [mode, setMode] = useState('month');
  const [pick, setPick] = useState(months[0].value);
  const [custom, setCustom] = useState({ from: `${new Date().getFullYear()}-01-01`, to: iso(new Date()) });
  const [company, setCompany] = useState('');
  const [source, setSource] = useState('');
  const [group, setGroup] = useState('week');
  const [drill, setDrill] = useState(null);
  const [q, setQ] = useState('');

  const [from, to] = mode === 'custom' ? [custom.from, custom.to] : pick.split('|');
  const base = { from, to, company, source };
  const { data, loading } = useApi(`/mis?${new URLSearchParams({ ...base, group })}`, [from, to, company, source, group]);
  const outward = useApi(`/mis/list?${new URLSearchParams({ ...base, metric: 'outward' })}`, [from, to, company, source]);
  const open = (metric, title, extra = {}) => setDrill({ title, params: { ...base, metric, ...extra } });

  const a = data?.actual || {};
  const p = data?.plan || {};
  const outRows = (outward.data || []).filter((r) => !q || `${r.name} ${r.code} ${r.mobile} ${r.source} ${r.designation}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">MIS Dashboard</h1>
          <p className="text-sm text-slate-500">Looker-style report, live from the portal. Click any number to see the names.</p>
        </div>
      </div>

      <div className="card flex flex-wrap items-end gap-3 p-3">
        <Tabs value={mode} onChange={(m) => { setMode(m); if (m === 'week') setPick(weeks[0].value); if (m === 'month') setPick(months[0].value); }} tabs={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'custom', label: 'Date range' }]} />
        {mode === 'week' && <div className="w-72"><Select value={pick} onChange={(e) => setPick(e.target.value)} options={weeks} /></div>}
        {mode === 'month' && <div className="w-48"><Select value={pick} onChange={(e) => setPick(e.target.value)} options={months} /></div>}
        {mode === 'custom' && <>
          <label className="text-xs text-slate-500">From<input type="date" className="input !py-1.5" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} /></label>
          <label className="text-xs text-slate-500">To<input type="date" className="input !py-1.5" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} /></label>
        </>}
        <div className="w-48"><Select value={company} onChange={(e) => setCompany(e.target.value)} placeholder="All companies" options={names('company')} /></div>
        <div className="w-44"><Select value={source} onChange={(e) => setSource(e.target.value)} placeholder="All platforms" options={names('source')} /></div>
        <span className="ml-auto text-xs text-slate-400">{fmtDate(from, false)} – {fmtDate(to, false)}</span>
      </div>

      {loading && !data ? <Spinner /> : (
        <>
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Actual</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
              <Score label="Inward" value={a.inward} onClick={() => open('inward', 'Inward')} />
              <Score label="Inward pending" value={a.inward_pending} tone="rose" onClick={() => open('inward_pending', 'Inward pending')} />
              <Score label="Outward" value={a.outward} tone="sky" onClick={() => open('outward', 'Outward')} />
              <Score label="Screening" value={a.screening} plan={p.screening} tone="sky" onClick={() => open('screening', 'Screening done')} />
              <Score label="Interview" value={a.interview} plan={p.interview} tone="amber" onClick={() => open('interview', 'Came for interview')} />
              <Score label="No. of selection" value={a.selection} plan={p.selection} tone="green" onClick={() => open('selection', 'Selected')} />
              <Score label="No. of retention (90d)" value={a.retention} plan={p.retention} tone="violet" onClick={() => open('retention', '90-day retained')} />
            </div>
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Actual onboarding</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
              <Score label="Pre-onboarding" value={a.pre_onboarding} tone="green" onClick={() => open('pre_onboarding', 'Pre-onboarding done')} />
              <Score label="No. HR orientation" value={a.hr_orientation} plan={p.hr_orientation} tone="green" onClick={() => open('hr_orientation', 'Joined – HR orientation')} />
              <Score label="Joining docs" value={a.joining_docs} tone="green" onClick={() => open('joining_docs', 'Joining form & documents')} />
              <Score label="No. accessories provided" value={a.accessories} plan={p.accessories} tone="green" onClick={() => open('accessories', 'Accessories provided')} />
              <Score label="Training" value={a.training} tone="green" onClick={() => open('training', 'Training done')} />
              <Score label="No. MIS scoring" value={a.mis_scoring} plan={p.mis_scoring} tone="green" onClick={() => open('mis_scoring', 'MIS scoring added')} />
              <Score label="30-day working" value={a.d30} tone="violet" onClick={() => open('d30', '30-day check – working')} />
              <Score label="60-day working" value={a.d60} tone="violet" onClick={() => open('d60', '60-day check – working')} />
            </div>
          </section>

          <Card title="Plan vs Actual – every step" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr><th className="th">Step</th><th className="th">Stage</th><th className="th text-right">Plan</th><th className="th text-right">Actual</th><th className="th text-right">On time</th><th className="th text-right">Achieved</th><th className="th text-right">Still pending</th></tr></thead>
                <tbody>{data.steps.map((s) => (
                  <tr key={s.code}>
                    <td className="td"><span className="text-xs text-slate-400">Step {s.no}</span> {s.name}</td>
                    <td className="td text-xs capitalize">{s.stage}</td>
                    <td className="td text-right"><button className="link tabular-nums" onClick={() => open(s.code, `Plan – ${s.name}`, { kind: 'plan' })}>{s.plan}</button></td>
                    <td className="td text-right"><button className="link tabular-nums" onClick={() => open(s.code, `Actual – ${s.name}`)}>{s.actual}</button></td>
                    <td className="td text-right tabular-nums">{s.on_time}</td>
                    <td className="td text-right">{s.pct == null ? '—' : <Badge color={s.pct >= 90 ? 'green' : s.pct >= 60 ? 'amber' : 'red'}>{s.pct}%</Badge>}</td>
                    <td className={`td text-right tabular-nums ${s.pending ? 'font-semibold text-rose-600' : ''}`}>{s.pending}</td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title={`5×3 report – ${group === 'week' ? 'weekly' : 'monthly'} by platform (Outward / Interview / Selection)`} bodyClass="p-0"
            actions={<Tabs value={group} onChange={setGroup} tabs={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }]} />}>
            {!data.matrix.periods.length ? <Empty /> : (
              <div className="max-h-[520px] overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10"><tr>
                    <th className="th sticky left-0 z-20">{group === 'week' ? 'Week / range' : 'Month'}</th>
                    {data.matrix.sources.map((s) => <th key={s} className="th border-l border-slate-200 text-center">{s}</th>)}
                    <th className="th border-l border-slate-200 text-center">Total</th>
                  </tr>
                  <tr>
                    <th className="th sticky left-0 z-20" />
                    {[...data.matrix.sources, 'Total'].map((s) => <th key={s} className="th border-l border-slate-200 text-center text-[10px] font-normal normal-case">Out · Int · Sel</th>)}
                  </tr></thead>
                  <tbody>{data.matrix.periods.map((per) => {
                    const [pf, pt] = periodRange(per, group);
                    const tot = { outward: 0, interview: 0, selection: 0 };
                    Object.values(per.cells).forEach((c) => { tot.outward += c.outward; tot.interview += c.interview; tot.selection += c.selection; });
                    const cell = (c, src) => (
                      <td key={src || 'total'} className="td border-l border-slate-100 text-center text-sm tabular-nums">
                        {c ? <>
                          <button className="link" onClick={() => setDrill({ title: `Outward – ${per.label}${src ? ` – ${src}` : ''}`, params: { ...base, from: pf, to: pt, metric: 'outward', ...(src ? { source: src } : {}) } })}>{c.outward}</button>
                          <span className="text-slate-300"> · </span>
                          <button className="link" onClick={() => setDrill({ title: `Interview – ${per.label}${src ? ` – ${src}` : ''}`, params: { ...base, from: pf, to: pt, metric: 'interview', ...(src ? { source: src } : {}) } })}>{c.interview}</button>
                          <span className="text-slate-300"> · </span>
                          <button className="link font-semibold !text-emerald-700" onClick={() => setDrill({ title: `Selection – ${per.label}${src ? ` – ${src}` : ''}`, params: { ...base, from: pf, to: pt, metric: 'selection', ...(src ? { source: src } : {}) } })}>{c.selection}</button>
                        </> : <span className="text-slate-300">—</span>}
                      </td>
                    );
                    return (
                      <tr key={per.key}>
                        <td className="td sticky left-0 bg-white"><div className="font-medium">{per.label}</div>{per.range && <div className="text-[11px] text-slate-500">{per.range}</div>}</td>
                        {data.matrix.sources.map((s) => cell(per.cells[s], s))}
                        {cell(tot, null)}
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Placement summary by platform" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{['Platform', 'Outward', 'Interview', 'Selection', 'Joined', 'Left', 'Agency ₹', 'Portal ₹', 'Selected candidates'].map((h, i) => <th key={h} className={`th ${i && i < 8 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{data.placement.map((pl) => (
                  <tr key={pl.source}>
                    <td className="td font-medium">{pl.source}</td>
                    <td className="td text-right tabular-nums"><button className="link" onClick={() => open('outward', `Outward – ${pl.source}`, { source: pl.source })}>{pl.outward}</button></td>
                    <td className="td text-right tabular-nums">{pl.interview}</td>
                    <td className="td text-right tabular-nums font-semibold text-emerald-700">{pl.selection}</td>
                    <td className="td text-right tabular-nums">{pl.joined}</td>
                    <td className="td text-right tabular-nums text-rose-600">{pl.left_count}</td>
                    <td className="td text-right tabular-nums">{pl.agency_payment ? inr(pl.agency_payment) : '—'}</td>
                    <td className="td text-right tabular-nums">{pl.portal_spend ? inr(pl.portal_spend) : '—'}</td>
                    <td className="td"><div className="flex max-w-xl flex-wrap gap-1">{pl.names.map((n) => <Link key={n.id} to={`/candidates/${n.id}`}><Badge color={n.status === 'Left' || n.status === 'Not Joined' ? 'red' : n.status === 'Joined' ? 'green' : 'blue'}>{n.name}</Badge></Link>)}</div></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card title="Retention by joining month (names)" bodyClass="p-0">
            {!data.retention.length ? <Empty /> : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr>{['Month', 'Name', 'Platform', 'Position', 'Joining', '30 d', '60 d', '90 d', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>{data.retention.flatMap((m) => m.people.map((o, i) => (
                    <tr key={o.id} className={i === 0 ? 'border-t-2 border-slate-200' : ''}>
                      <td className="td font-medium">{i === 0 ? <>{m.label}<div className="text-[11px] font-normal text-slate-500">{m.people.length} joinees · {m.people.filter((x) => x.status === 'Retained 90').length} retained · {m.people.filter((x) => x.status === 'Left' || x.status === 'Not Joined').length} left</div></> : ''}</td>
                      <td className="td"><Link className="link" to={`/onboarding/${o.id}`}>{o.name}</Link></td>
                      <td className="td text-xs">{o.source}</td>
                      <td className="td text-xs">{o.designation}</td>
                      <td className="td whitespace-nowrap text-xs">{fmtDate(o.joining_date, false)}</td>
                      {[o.d30, o.d60, o.d90].map((v, k) => <td key={k} className="td text-xs">{v ? <Badge color={v === 'Working' ? 'green' : 'red'}>{v === 'Working' ? '✓' : v}</Badge> : <span className="text-slate-300">–</span>}</td>)}
                      <td className="td"><StatusBadge value={o.status} /></td>
                    </tr>)))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={`Actual outward – candidates list (${outward.data?.length ?? '…'})`} bodyClass="p-0"
            actions={<div className="relative w-64"><Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" /><input className="input !py-1.5 pl-8" placeholder="Search name, mobile, platform…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}>
            <div className="max-h-[480px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0"><tr>{['ID', 'Name', 'Mobile', 'Platform', 'Position', 'Date', 'Current step', 'Status'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                <tbody>{outRows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="td"><Link className="link" to={`/candidates/${r.id}`}>{r.code}</Link></td>
                    <td className="td font-medium">{r.name}</td><td className="td text-xs">{r.mobile}</td><td className="td text-xs">{r.source}</td>
                    <td className="td text-xs">{r.designation}<div className="text-slate-400">{r.company}</div></td>
                    <td className="td whitespace-nowrap text-xs">{fmtDate(r.date, false)}</td><td className="td text-xs">{r.stage}</td><td className="td"><StatusBadge value={r.status} /></td>
                  </tr>))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
      <NamesModal q={drill} onClose={() => setDrill(null)} />
    </div>
  );
}
