// Chart building blocks (Recharts) following one palette: fixed categorical order, thin marks,
// recessive grid, tooltip on every chart, legend for >= 2 series.
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, Legend, Cell } from 'recharts';

export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a'];
const AXIS = { fontSize: 11, fill: '#64748b' };
const GRID = '#e2e8f0';

const TipBox = ({ active, payload, label, fmt = (v) => v }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-semibold text-slate-700">{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-slate-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          {p.name}: <b className="text-slate-800">{fmt(p.value)}</b>
        </div>
      ))}
    </div>
  );
};

/** Horizontal bars – funnel and ranked categories (single series) */
export function HBar({ data, x, y, name, height = 260, fmt }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey={y} tick={AXIS} width={130} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} content={<TipBox fmt={fmt} />} />
        <Bar dataKey={x} name={name} fill={SERIES[0]} radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11, fill: '#334155' }} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function VBar({ data, x, y, name, height = 240, highlight }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: -16, right: 8, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={x} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip cursor={{ fill: '#f1f5f9' }} content={<TipBox />} />
        <Bar dataKey={y} name={name} fill={SERIES[0]} radius={[4, 4, 0, 0]} maxBarSize={36}>
          {highlight && data.map((d, i) => <Cell key={i} fill={highlight(d) ? SERIES[1] : SERIES[0]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Multi-line on ONE axis (same unit) */
export function Lines({ data, x, series, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: -16, right: 12, top: 8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey={x} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<TipBox />} cursor={{ stroke: '#94a3b8', strokeDasharray: '3 3' }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
        {series.map((s, i) => (
          <Line key={s.key} dataKey={s.key} name={s.name} stroke={SERIES[i]} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, fill: '#fff' }} activeDot={{ r: 5 }} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
