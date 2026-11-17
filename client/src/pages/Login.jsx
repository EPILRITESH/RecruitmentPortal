import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, auth } from '../api';
import { Button, Field, ErrorBox } from '../components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api('/auth/login', { method: 'POST', body: { email, password } });
      auth.set(r.token, r.user);
      nav('/');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <div className="grid min-h-full lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="grid h-10 w-10 place-items-center rounded-lg bg-white/15 text-lg font-bold">R</div>
          <span className="text-lg font-semibold">EPIL Recruitment Portal</span>
        </div>
        <div>
          <h1 className="text-4xl font-semibold leading-tight">From requirement<br />to joining – and beyond.</h1>
          <p className="mt-4 max-w-md text-indigo-100">Inward → Outward → Onboarding in one place. Every step has an owner, a planned date and an automatic reminder. AI writes the JD, reads the CV and screens the candidate.</p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-center text-sm">
            {[['26', 'tracked steps'], ['5', 'AI agents'], ['0', 'Google Forms']].map(([n, l]) => (
              <div key={l} className="rounded-xl bg-white/10 px-3 py-4"><div className="text-2xl font-semibold">{n}</div><div className="text-indigo-100">{l}</div></div>
            ))}
          </div>
        </div>
        <div className="text-sm text-indigo-200">Hire smarter, grow stronger.</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Sign in</h2>
            <p className="text-sm text-slate-500">Staff: use your email. Employees: use your mobile number.</p>
          </div>
          <Field label="Email or mobile number"><input className="input" type="text" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required /></Field>
          <Field label="Password"><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
          <ErrorBox error={error} />
          <Button className="w-full" loading={busy}>Sign in</Button>
          <p className="text-xs text-slate-400">Forgot your password? Ask the portal admin to reset it in Settings → Users.</p>
        </form>
      </div>
    </div>
  );
}
