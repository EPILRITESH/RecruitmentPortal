import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ListChecks, Siren, ClipboardList, Users, UserCheck, Bot, BarChart3, Wallet, Settings, BookOpen, LogOut, Menu, X, Globe,
} from 'lucide-react';
import { api, auth, ROLE_LABEL } from '../api';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/tasks', label: 'My Tasks', icon: ListChecks, badge: 'tasks' },
  { to: '/rescue', label: 'Rescue Board', icon: Siren, badge: 'overdue' },
  { section: 'Recruitment' },
  { to: '/requirements', label: 'Inward – Requirements', icon: ClipboardList },
  { to: '/candidates', label: 'Outward – Candidates', icon: Users },
  { to: '/onboarding', label: 'Onboarding', icon: UserCheck },
  { section: 'Intelligence' },
  { to: '/ai', label: 'AI Agents', icon: Bot },
  { to: '/reports', label: 'Reports & MIS', icon: BarChart3 },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { section: 'Help' },
  { to: '/guide', label: 'Process Guide', icon: BookOpen },
  { to: '/settings', label: 'Settings', icon: Settings, admin: true },
];

export default function Layout() {
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState({});
  const user = auth.user;
  const nav = useNavigate();
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
    api('/tasks/summary').then((s) => setCounts({ tasks: s.overdue + s.today, overdue: s.overdue })).catch(() => {});
  }, [loc.pathname]);

  const logout = () => { auth.clear(); nav('/login'); };

  const sidebar = (
    <div className="flex h-full flex-col bg-slate-900 text-slate-300">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-indigo-500 font-bold text-white">R</div>
        <div>
          <div className="text-sm font-semibold text-white">EPIL Recruitment</div>
          <div className="text-[11px] text-slate-400">FMS-26 Portal</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
        {NAV.filter((n) => !n.admin || user?.role === 'admin').map((n, i) => n.section ? (
          <div key={i} className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500">{n.section}</div>
        ) : (
          <NavLink key={n.to} to={n.to} end={n.end}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${isActive ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60 hover:text-white'}`}>
            <n.icon className="h-4 w-4 shrink-0" />
            <span className="flex-1 truncate">{n.label}</span>
            {n.badge && counts[n.badge] > 0 && (
              <span className={`rounded-full px-1.5 text-[11px] font-semibold ${n.badge === 'overdue' ? 'bg-rose-500 text-white' : 'bg-indigo-500 text-white'}`}>{counts[n.badge]}</span>
            )}
          </NavLink>
        ))}
        <a href="/careers" target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-800/60 hover:text-white">
          <Globe className="h-4 w-4" /> Careers page (public)
        </a>
      </nav>
      <div className="border-t border-slate-800 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-slate-700 text-xs font-semibold text-white">{user?.name?.[0]}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm text-white">{user?.name}</div>
            <div className="truncate text-[11px] text-slate-400">{ROLE_LABEL[user?.role]}</div>
          </div>
          <button onClick={logout} title="Logout" className="rounded p-1.5 hover:bg-slate-800"><LogOut className="h-4 w-4" /></button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="relative h-full w-64">{sidebar}</aside>
          <button className="absolute left-[16.5rem] top-4 rounded bg-white p-1" onClick={() => setOpen(false)}><X className="h-5 w-5" /></button>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></button>
          <span className="font-semibold">EPIL Recruitment</span>
        </header>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
