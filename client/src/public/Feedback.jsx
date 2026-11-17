import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Star } from 'lucide-react';
import { api } from '../api';
import { Button, Field, ErrorBox, Spinner } from '../components/ui';
import { PublicShell } from './Apply';

const QUESTIONS = ['Was your joining process smooth?', 'Did you get proper training and a buddy?', 'Is the work as explained in the interview?'];

export default function Feedback() {
  const { token } = useParams();
  const [info, setInfo] = useState(null);
  const [rating, setRating] = useState(0);
  const [answers, setAnswers] = useState({});
  const [comments, setComments] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api(`/public/feedback/${token}`).then(setInfo).catch((e) => setError(e.message)); }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (!rating) return setError('Please give a rating');
    setBusy(true); setError(null);
    try {
      await api(`/public/feedback/${token}`, { method: 'POST', body: { rating, comments: `${QUESTIONS.map((q) => `${q} ${answers[q] || '-'}`).join(' | ')} | ${comments}`, ...answers } });
      setDone(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  if (error && !info) return <PublicShell title="Feedback"><ErrorBox error={error} /></PublicShell>;
  if (!info) return <Spinner />;
  return (
    <PublicShell title="Joining feedback" subtitle={`${info.designation} – ${info.company}`}>
      {done ? <div className="card p-8 text-center"><CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" /><p className="mt-3 font-medium">Thank you {info.name}! Welcome to the team.</p></div> : (
        <form onSubmit={submit} className="card space-y-4 p-5">
          <div>
            <div className="label">Overall experience of your first week</div>
            <div className="flex gap-1">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} onClick={() => setRating(n)}><Star className={`h-8 w-8 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'}`} /></button>)}</div>
          </div>
          {QUESTIONS.map((q) => (
            <div key={q}><div className="label">{q}</div>
              <div className="flex gap-2">{['Yes', 'Partly', 'No'].map((a) => <button type="button" key={a} onClick={() => setAnswers({ ...answers, [q]: a })} className={`rounded-lg border px-3 py-1.5 text-sm ${answers[q] === a ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-200'}`}>{a}</button>)}</div>
            </div>
          ))}
          <Field label="Anything we can improve?"><textarea className="input" rows={3} value={comments} onChange={(e) => setComments(e.target.value)} /></Field>
          <ErrorBox error={error} />
          <Button className="w-full" loading={busy}>Submit feedback</Button>
        </form>
      )}
    </PublicShell>
  );
}
