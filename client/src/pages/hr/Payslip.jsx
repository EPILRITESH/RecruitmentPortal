import { useParams, useNavigate } from 'react-router-dom';
import { Printer, ArrowLeft } from 'lucide-react';
import { fmtDate } from '../../api';
import { useApi, Spinner, ErrorBox, Button } from '../../components/ui';

const money = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function Payslip() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: p, error, loading } = useApi(`/payslips/${id}`, [id]);
  if (error) return <ErrorBox error={error} />;
  if (loading || !p) return <Spinner />;
  const e = p.employee;
  const rows = Math.max(p.earnings.length, p.deductions.length);
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex justify-between print:hidden">
        <button onClick={() => nav(-1)} className="link flex items-center gap-1 text-sm"><ArrowLeft className="h-4 w-4" />Back</button>
        <Button icon={Printer} onClick={() => window.print()}>Print / Save as PDF</Button>
      </div>
      <div className="rounded-xl border border-slate-300 bg-white p-6 text-[13px] text-slate-800 print:border-0 print:p-0">
        <div className="flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div><div className="text-xl font-bold">{e.company || p.company_name}</div><div className="text-xs text-slate-500">{p.address}</div></div>
          <div className="text-right"><div className="text-lg font-semibold">Salary slip</div><div>{monthName(p.month)}</div></div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-1">
          {[['Employee', e.name], ['Employee code', e.emp_code], ['Designation', e.designation], ['Department', e.department], ['Date of joining', fmtDate(e.joining_date, false)], ['Location', e.location],
            ['Bank', `${e.bank_name || '—'} ${e.account_no ? `· A/c ${e.account_no}` : ''}`], ['IFSC', e.ifsc], ['PAN', e.pan], ['UAN / ESIC', `${e.uan || '—'} / ${e.esic_no || '—'}`]].map(([k, v]) => (
            <div key={k} className="flex gap-2"><span className="w-32 shrink-0 text-slate-500">{k}</span><span className="font-medium">{v || '—'}</span></div>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded border border-slate-300 bg-slate-300 text-center sm:grid-cols-8">
          {[['Days', p.days_in_month], ['Present', p.present + p.half * 0.5 + p.off_day_worked], ['Paid leave', p.paid_leave], ['Week off', p.weekly_off], ['Holidays', p.holiday], ['Absent / LOP', p.lop_days], ['OT hours', p.ot_hours], ['Paid days', p.paid_days]].map(([k, v]) => (
            <div key={k} className="bg-white px-1 py-1.5"><div className="text-[10px] uppercase text-slate-500">{k}</div><div className="font-semibold">{v}</div></div>
          ))}
        </div>
        {(p.late > 0 || p.projected > 0 || p.late_penalty_days > 0) && <p className="mt-1 text-[11px] text-slate-500">{p.late ? `Late marks: ${p.late}${p.late_penalty_days ? ` (½-day cuts: ${p.late_penalty_days})` : ''}. ` : ''}{p.projected ? `${p.projected} future days counted as projected.` : ''}</p>}
        <table className="mt-4 w-full border border-slate-300">
          <thead><tr className="bg-slate-100"><th className="border-r border-slate-300 px-2 py-1.5 text-left">Earnings</th><th className="border-r border-slate-300 px-2 py-1.5 text-right">Amount ₹</th><th className="border-r border-slate-300 px-2 py-1.5 text-left">Deductions</th><th className="px-2 py-1.5 text-right">Amount ₹</th></tr></thead>
          <tbody>
            {Array.from({ length: rows }).map((_, i) => (
              <tr key={i} className="border-t border-slate-200">
                <td className="border-r border-slate-300 px-2 py-1">{p.earnings[i]?.name}{p.earnings[i]?.fixed ? <span className="text-[10px] text-slate-400"> (of {money(p.earnings[i].fixed)})</span> : null}</td>
                <td className="border-r border-slate-300 px-2 py-1 text-right tabular-nums">{p.earnings[i] ? money(p.earnings[i].amount) : ''}</td>
                <td className="border-r border-slate-300 px-2 py-1">{p.deductions[i]?.name}</td>
                <td className="px-2 py-1 text-right tabular-nums">{p.deductions[i] ? money(p.deductions[i].amount) : ''}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-400 font-semibold"><td className="border-r border-slate-300 px-2 py-1.5">Gross earnings</td><td className="border-r border-slate-300 px-2 py-1.5 text-right">{money(p.gross)}</td><td className="border-r border-slate-300 px-2 py-1.5">Total deductions</td><td className="px-2 py-1.5 text-right">{money(p.total_deductions)}</td></tr>
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between rounded bg-slate-800 px-4 py-2.5 text-white"><span className="font-semibold">Net pay</span><span className="text-lg font-bold">₹ {money(p.net)}</span></div>
        <div className="mt-1 text-xs italic text-slate-600">{p.net_words}</div>
        {p.employer.length > 0 && <div className="mt-3 text-[11px] text-slate-500">Employer contribution (not deducted): {p.employer.map((x) => `${x.name} ₹${money(x.amount)}`).join(' · ')}</div>}
        <div className="mt-8 flex justify-between text-[11px] text-slate-500"><span>This is a computer-generated salary slip and does not need a signature.</span><span>{p.run_status === 'Draft' ? 'DRAFT' : ''}</span></div>
      </div>
    </div>
  );
}
