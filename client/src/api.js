const TOKEN_KEY = 'epil_rp_token';
const USER_KEY = 'epil_rp_user';

export const auth = {
  get token() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  get user() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } },
  set(token, user) { try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* ignore */ } },
  clear() { try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ } },
};

export async function api(path, { method = 'GET', body, form } = {}) {
  const headers = {};
  if (auth.token) headers.Authorization = `Bearer ${auth.token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 401 && !path.startsWith('/auth') && !path.startsWith('/public')) {
    auth.clear();
    window.location.href = '/login';
    throw new Error('Session expired');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = new Error(data?.error || `Error ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const fileUrl = (name) => `/api/files/${encodeURIComponent(name)}?token=${auth.token}`;
export const exportUrl = (what) => `/api/reports/export/${what}?token=${auth.token}`;

export function fmtDate(s, withTime = true) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString('en-IN', withTime && String(s).length > 10 ? { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: '2-digit' });
}

export function relTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  const h = Math.round((Date.now() - d.getTime()) / 36e5);
  if (Math.abs(h) < 1) return 'now';
  if (Math.abs(h) < 24) return h > 0 ? `${h}h ago` : `in ${-h}h`;
  const days = Math.round(h / 24);
  return days > 0 ? `${days}d ago` : `in ${-days}d`;
}

export const inr = (n) => (n == null ? '—' : `₹${Number(n).toLocaleString('en-IN')}`);

export const ROLE_LABEL = {
  admin: 'Admin', recruiter: 'Recruiter', hr: 'HR', pc: 'PC (Verification)', approver: 'Approver', hod: 'HOD / Manager', ea: 'EA – MIS', accounts: 'Accounts', employee: 'Employee',
};
