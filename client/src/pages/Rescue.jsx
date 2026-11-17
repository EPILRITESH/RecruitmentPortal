import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { api, fmtDate, ROLE_LABEL } from '../api';
import { useApi, Spinner, Empty, Badge, Button, PageHeader, Card, Stat, toast } from '../components/ui';
import { TaskModal } from '../components/workflow';

const recordLink = (t) => (t.entity_type === 'requirement' ? `/requirements/${t.entity_id}` : t.entity_type === 'candidate' ? `/candidates/${t.entity_id}` : `/onboarding/${t.entity_id}`);

export default function Rescue() {
  const { data, loading, reload } = useApi('/reports/rescue?escalation_hours=48');
  const [active, setActive] = useState(null);
  const [onlyEsc, setOnlyEsc] = useState(false);

  const groups = useMemo(() => {
    const g = {};
    for (const t of (data || []).filter((x) => !onlyEsc || x.escalate)) {
      const key = t.doer_name || ROLE_LABEL[t.doer_role] || t.doer_role;
      (g[key] ||= []).push(t);
    }
    return Object.entries(g).sort((a, b) => b[1].length - a[1].length);
  }, [data, onlyEsc]);

  const followUp = async (t) => {
    await api(`/tasks/${t.id}/follow-up`, { method: 'POST', body: {} });
    toast('Follow-up logged'); reload();
  };

  if (loading && !data) return <Spinner />;
  const esc = data.filter((t) => t.escalate).length;
  return (
    <div>
      <PageHeader title="Rescue Board" subtitle="All late steps across the team, grouped by doer. Late more than 48 hours = escalated to the problem solver (Ritesh Sir)." />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon={Siren} tone="red" label="Overdue steps" value={data.length} />
        <Stat icon={Siren} tone="amber" label="Escalated (> 48 h)" value={esc} onClick={() => setOnlyEsc(!onlyEsc)} sub={onlyEsc ? 'showing escalated only' : 'click to filter'} />
        <Stat label="Doers with late work" value={groups.length} />
        <Stat label="Oldest delay" value={data[0] ? `${Math.round(Math.max(...data.map((t) => t.overdue_hours)) / 24)}d` : '0'} />
      </div>
      {!groups.length ? <Empty text="Nothing overdue – great job!" /> : (
        <div className="space-y-5">
          {groups.map(([doer, tasks]) => (
            <Card key={doer} title={<span>{doer} <Badge color="red" className="ml-2">{tasks.length} late</Badge></span>} bodyClass="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><th className="th">Record</th><th className="th">Step</th><th className="th">Planned</th><th className="th">Late by</th><th className="th">Follow-ups</th><th className="th" /></tr></thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id} className={t.escalate ? 'bg-rose-50/40' : ''}>
                        <td className="td"><Link className="link" to={recordLink(t)}>{t.record_code}</Link><div className="text-xs text-slate-500">{t.title}</div></td>
                        <td className="td">Step {t.no} · {t.short_name}</td>
                        <td className="td whitespace-nowrap text-xs">{fmtDate(t.planned_at)}</td>
                        <td className="td whitespace-nowrap"><Badge color={t.escalate ? 'red' : 'amber'}>{t.overdue_hours >= 48 ? `${Math.round(t.overdue_hours / 24)} days` : `${t.overdue_hours} h`}</Badge></td>
                        <td className="td text-xs">{t.follow_ups || 0}{t.last_follow_up ? ` · last ${fmtDate(t.last_follow_up)}` : ''}</td>
                        <td className="td whitespace-nowrap text-right">
                          <Button size="sm" variant="secondary" onClick={() => followUp(t)}>Log follow-up</Button>{' '}
                          <Button size="sm" onClick={() => setActive(t)}>Update</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
      {active && <TaskModal task={active} onClose={() => setActive(null)} onDone={reload} />}
    </div>
  );
}
