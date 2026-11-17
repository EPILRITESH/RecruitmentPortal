import { ArrowRight, ArrowDown } from 'lucide-react';
import { ROLE_LABEL } from '../api';
import { useApi, Card, PageHeader, Spinner, Badge } from '../components/ui';

const STAGES = [
  { key: 'inward', title: '1 · INWARD – we need a person', color: 'border-indigo-300 bg-indigo-50', text: 'HOD raises a requirement → recruiter prepares JD (AI) and gets HOD approval → posts on portals → PC verifies.' },
  { key: 'outward', title: '2 · OUTWARD – we find the person', color: 'border-sky-300 bg-sky-50', text: 'Candidates from Work India / Apna / LinkedIn / references / consultancies → screening → interest → form → interview → (hold → Ritesh Sir) → final select → email consultancy → PC verifies.' },
  { key: 'onboarding', title: '3 · ONBOARDING – we welcome & keep the person', color: 'border-emerald-300 bg-emerald-50', text: 'Created automatically on final selection. Every step is planned from the joining date – up to the 90-day retention check.' },
];

const OLD_NEW = [
  ['Google Form (Inward)', 'New requirement form in portal (HODs can log in)'],
  ['Manual JD in Word', 'AI JD Generator + HOD approval button'],
  ['Outward Google Form', 'Add candidate + AI CV Parser + duplicate mobile check'],
  ['Candidate fills Google Form / printout', 'Personal form link on WhatsApp – Step 6 ticks itself'],
  ['Looker → update status one by one', 'My Tasks – one click result, next step created automatically'],
  ['Studio-2.0 log (duplicates)', 'One row per step per record – duplicates impossible'],
  ['Rescue Sheet', 'Rescue Board with follow-up log + 48 h escalation'],
  ['Hold → ask Ritesh Sir on phone', 'Step 9 lands in Ritesh Sir’s own task list'],
  ['Manual email to consultancy', 'One-click selection email from template'],
  ['ONBOARDING FMS + checklists', 'Onboarding record with checklist, planned from joining date'],
  ['RETENTION / PORTAL SUMMARY / Conversion tabs', 'Reports & MIS – live, no #REF! or #N/A'],
  ['Blank dates = 30/12/1899', 'Empty dates stay empty'],
];

export default function ProcessGuide() {
  const { data } = useApi('/steps');
  return (
    <div className="space-y-5">
      <PageHeader title="Process Guide – FMS-26 on the portal" subtitle="Who does what, by when, and how. Result: fill our vacancy as soon as possible. Doer: Recruiter · Buddy: Maitri · Problem solver: Ritesh Sir." />
      <div className="grid gap-3 lg:grid-cols-3">
        {STAGES.map((s, i) => (
          <div key={s.key} className={`relative rounded-xl border-2 p-4 ${s.color}`}>
            <div className="font-semibold text-slate-800">{s.title}</div>
            <p className="mt-1 text-sm text-slate-600">{s.text}</p>
            {i < 2 && <ArrowRight className="absolute -right-5 top-1/2 hidden h-6 w-6 -translate-y-1/2 text-slate-400 lg:block" />}
          </div>
        ))}
      </div>

      {!data ? <Spinner /> : STAGES.map((st) => (
        <Card key={st.key} title={st.title} bodyClass="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><th className="th">Step</th><th className="th">What</th><th className="th">Who</th><th className="th">How</th><th className="th">When (TAT)</th><th className="th">Possible results</th></tr></thead>
              <tbody>{data.filter((s) => s.stage === st.key).map((s) => (
                <tr key={s.code}>
                  <td className="td font-semibold text-slate-500">{s.no}</td>
                  <td className="td font-medium">{s.name}{s.optional ? <Badge className="ml-2">only on hold</Badge> : null}</td>
                  <td className="td text-sm">{ROLE_LABEL[s.doer_role]}</td>
                  <td className="td text-sm text-slate-600">{s.how}</td>
                  <td className="td whitespace-nowrap text-sm">{s.anchor === 'joining' ? (s.tat_days < 0 ? `${-s.tat_days} days before joining` : s.tat_days === 0 ? 'Joining day' : `Joining + ${s.tat_days} days`) : s.tat_days === 0 ? 'Same day' : `${s.tat_days} working day${s.tat_days == 1 ? '' : 's'}`}</td>
                  <td className="td"><div className="flex flex-wrap gap-1">{s.options.map((o) => <Badge key={o.value} color={o.color === 'red' ? 'red' : o.color === 'amber' ? 'amber' : o.color === 'slate' ? 'slate' : 'green'}>{o.label}</Badge>)}</div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      ))}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Daily routine (training guidelines)">
          <ol className="space-y-2 text-sm text-slate-700">
            {['Open My Tasks every morning – clear “Overdue” first, then “Due today”.', 'Add every candidate the same day you get the profile (upload resume → AI fills it).',
              'Use the WhatsApp button on each task – the right template is already selected.', 'Follow the steps in sequence – the portal will not skip a step.',
              'Hold cases go to Ritesh Sir automatically – remind him from the Rescue Board if late.', 'Write a short remark when the result is negative – it helps the next hiring.',
              'Before closing a requirement, make sure the joinee is in Onboarding.'].map((x, i) => (
              <li key={i} className="flex gap-2"><span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700">{i + 1}</span>{x}</li>
            ))}
          </ol>
        </Card>
        <Card title="Old FMS-26 → New portal" bodyClass="p-0">
          <table className="w-full"><tbody>{OLD_NEW.map(([o, n]) => (
            <tr key={o}><td className="td text-sm text-slate-500">{o}</td><td className="td w-6"><ArrowRight className="h-4 w-4 text-slate-300" /></td><td className="td text-sm font-medium text-slate-700">{n}</td></tr>
          ))}</tbody></table>
        </Card>
      </div>
      <div className="flex items-center justify-center gap-2 text-sm text-slate-400"><ArrowDown className="h-4 w-4" /> Step numbers here are the single official list for the portal (old sheet numbers 13–26 were re-ordered).</div>
    </div>
  );
}
