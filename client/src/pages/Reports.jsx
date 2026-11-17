import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { exportUrl, inr } from '../api';
import { useApi, Card, PageHeader, Spinner, Tabs, Button, Badge } from '../components/ui';
import { HBar, VBar } from '../components/charts';

const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const monthLabel = (m) => (m ? new Date(`${m}-01T00:00`).toLocaleString('en-IN', { month: 'short', year: '2-digit' }) : '—');

export default function Reports() {
  const [tab, setTab] = useState('sources');
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState('');
  const { data, loading } = useApi(`/dashboard?from=${from}&to=${to}`, [from, to]);
  const portal = useApi(tab === 'portal' ? '/reports/portal-summary' : null, [tab]);

  const portalMatrix = useMemo(() => {
    const rows = portal.data || [];
    const sources = [...new Set(rows.map((r) => r.source))];
    const weeks = [...new Set(rows.map((r) => r.week))];
    return { sources, weeks, get: (w, s) => rows.find((r) => r.week === w && r.source === s) };
  }, [portal.data]);

  if (loading && !data) return <Spinner />;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports & MIS" subtitle="Live replacement for the Looker Studio dashboard, PORTAL SUMMARY, RETENTION and Conversion Rate tabs."
        actions={['requirements', 'candidates', 'onboardings', 'steps'].map((w) => <a key={w} href={exportUrl(w)}><Button size="sm" variant="secondary" icon={Download}>{w}</Button></a>)} />
      <div className="flex flex-wrap items-end gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'sources', label: 'Funnel & sources' }, { value: 'steps', label: 'Step performance' }, { value: 'retention', label: 'Retention' }, { value: 'portal', label: 'Portal summary' }]} />
        <label className="text-xs text-slate-500">From<input type="date" className="input !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-xs text-slate-500">To<input type="date" className="input !py-1.5" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>

      {tab === 'sources' && (
        <>
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="Hiring funnel"><HBar data={data.funnel} x="value" y="stage" name="Candidates" /></Card>
            <Card title="Candidates sourced by source"><HBar data={data.sources} x="outward" y="source" name="Sourced" /></Card>
          </div>
          <Card title={`Source performance & cost (total spend ${inr(data.spend_total)})`} bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{['Source', 'Sourced', 'Interviews', 'Selected', 'Joined', 'Interview %', 'Selection %', 'Spend', 'Cost / joinee'].map((h, i) => <th key={h} className={`th ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{data.sources.map((s) => (
                  <tr key={s.source}>
                    <td className="td font-medium">{s.source}</td><td className="td text-right tabular-nums">{s.outward}</td><td className="td text-right tabular-nums">{s.interviews}</td>
                    <td className="td text-right tabular-nums">{s.selected}</td><td className="td text-right tabular-nums">{s.joined}</td>
                    <td className="td text-right tabular-nums">{pct(s.interviews, s.outward)}</td><td className="td text-right tabular-nums">{s.conversion}%</td>
                    <td className="td text-right tabular-nums">{inr(s.spend)}</td><td className="td text-right tabular-nums">{s.cost_per_hire != null ? inr(s.cost_per_hire) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      {tab === 'steps' && (
        <>
          <Card title="Open overdue steps by step"><VBar data={data.steps.filter((s) => s.overdue > 0).map((s) => ({ ...s, label: `S${s.no}` }))} x="label" y="overdue" name="Overdue" /></Card>
          <Card title="Step-wise on-time performance (planned vs actual)" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead><tr>{['Step', 'Stage', 'Doer', 'Done', 'On time %', 'Avg delay', 'Pending', 'Overdue'].map((h, i) => <th key={h} className={`th ${i > 2 ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
                <tbody>{data.steps.map((s) => (
                  <tr key={s.code}>
                    <td className="td"><span className="text-xs text-slate-400">Step {s.no}</span> {s.short_name}</td><td className="td text-xs capitalize">{s.stage}</td><td className="td text-xs">{s.doer_role}</td>
                    <td className="td text-right tabular-nums">{s.done}</td>
                    <td className="td text-right">{s.on_time_pct == null ? '—' : <Badge color={s.on_time_pct >= 80 ? 'green' : s.on_time_pct >= 50 ? 'amber' : 'red'}>{s.on_time_pct}%</Badge>}</td>
                    <td className="td text-right tabular-nums">{s.avg_delay_h ? `${s.avg_delay_h > 48 ? `${Math.round(s.avg_delay_h / 24)} d` : `${s.avg_delay_h} h`}` : '—'}</td>
                    <td className="td text-right tabular-nums">{s.pending}</td><td className={`td text-right tabular-nums ${s.overdue ? 'font-semibold text-rose-600' : ''}`}>{s.overdue}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
          <Card title="Pending work by doer" bodyClass="p-0">
            <table className="w-full"><thead><tr><th className="th">Role</th><th className="th">Person</th><th className="th text-right">Pending</th><th className="th text-right">Overdue</th></tr></thead>
              <tbody>{data.workload.map((w, i) => <tr key={i}><td className="td">{w.role}</td><td className="td">{w.person || '—'}</td><td className="td text-right">{w.pending}</td><td className="td text-right font-semibold text-rose-600">{w.overdue}</td></tr>)}</tbody></table>
          </Card>
        </>
      )}

      {tab === 'retention' && (
        <Card title="Monthly retention (by joining month)" bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>{['Month', 'Selected', 'Not joined', 'Not-join %', 'Joined', '30 days ✓', '60 days ✓', '90 days ✓', '90-day retention %', 'Left'].map((h, i) => <th key={h} className={`th ${i ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
              <tbody>{data.retention.map((r) => (
                <tr key={r.month}>
                  <td className="td font-medium">{monthLabel(r.month)}</td><td className="td text-right">{r.selected}</td><td className="td text-right">{r.not_joined}</td>
                  <td className="td text-right">{pct(r.not_joined, r.selected)}</td><td className="td text-right">{r.joined}</td>
                  <td className="td text-right">{r.d30}</td><td className="td text-right">{r.d60}</td><td className="td text-right">{r.d90}</td>
                  <td className="td text-right">{pct(r.d90, r.selected)}</td><td className="td text-right text-rose-600">{r.left_count}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'portal' && (
        <Card title="Weekly portal summary (outward / interviews / selections per source)" bodyClass="p-0">
          {portal.loading ? <Spinner /> : (
            <div className="max-h-[600px] overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0"><tr><th className="th">Week</th>{portalMatrix.sources.map((s) => <th key={s} className="th text-right">{s}</th>)}</tr></thead>
                <tbody>{portalMatrix.weeks.map((w) => (
                  <tr key={w}><td className="td whitespace-nowrap font-medium">{w}</td>
                    {portalMatrix.sources.map((s) => { const c = portalMatrix.get(w, s); return <td key={s} className="td text-right text-xs tabular-nums">{c ? <><b>{c.outward}</b> / {c.interviews} / <span className="text-emerald-600">{c.selections}</span></> : '—'}</td>; })}
                  </tr>
                ))}</tbody>
              </table>
              <p className="p-3 text-xs text-slate-400">Each cell: sourced / interviews / selections</p>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
