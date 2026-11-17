// Auth, users, masters, settings, steps config, holidays, templates
import { Router } from 'express';
import { all, get, run, now, setting, setSetting } from '../db.js';
import { requireAuth, requireRole, hashPassword, checkPassword, signToken, ROLES } from '../auth.js';
import { getSteps } from '../workflow.js';
import { AGENTS, aiAvailable } from '../ai.js';

const r = Router();

r.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const u = await get('SELECT * FROM users WHERE lower(email)=lower(?)', email || '');
  if (!u || !u.active || !checkPassword(password || '', u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' });
  if (u.password_hash.startsWith('$2')) await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(password), u.id); // upgrade old hash
  res.json({ token: await signToken(u), user: { id: u.id, name: u.name, email: u.email, role: u.role } });
});

r.use(requireAuth);

r.get('/me', (req, res) => res.json({ user: req.user, roles: ROLES }));
r.post('/me/password', async (req, res) => {
  const { current, next } = req.body || {};
  const u = await get('SELECT * FROM users WHERE id=?', req.user.id);
  if (!checkPassword(current || '', u.password_hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (!next || next.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(next), u.id);
  res.json({ ok: true });
});

// ---- users ----
r.get('/users', async (req, res) => res.json({ users: await all('SELECT id,name,email,phone,role,active,created_at FROM users ORDER BY name'), roles: ROLES }));
r.post('/users', requireRole(), async (req, res) => {
  const { name, email, phone, role, password } = req.body || {};
  if (!name || !email || !ROLES[role]) return res.status(400).json({ error: 'Name, email and a valid role are required' });
  if (await get('SELECT id FROM users WHERE lower(email)=lower(?)', email)) return res.status(400).json({ error: 'Email already exists' });
  const x = await run('INSERT INTO users(name,email,phone,role,password_hash,created_at) VALUES(?,?,?,?,?,?)', name, email, phone, role, hashPassword(password || 'epil@123'), now());
  res.json({ id: Number(x.lastInsertRowid) });
});
r.put('/users/:id', requireRole(), async (req, res) => {
  const { name, phone, role, active, password } = req.body || {};
  await run('UPDATE users SET name=COALESCE(?,name), phone=COALESCE(?,phone), role=COALESCE(?,role), active=COALESCE(?,active) WHERE id=?', name, phone, role, active, req.params.id);
  if (password) await run('UPDATE users SET password_hash=? WHERE id=?', hashPassword(password), req.params.id);
  res.json({ ok: true });
});

// ---- masters ----
r.get('/masters', async (req, res) => {
  const rows = await all('SELECT * FROM masters WHERE active=1 ORDER BY type, name');
  const grouped = {};
  for (const m of rows) (grouped[m.type] ||= []).push(m);
  res.json(grouped);
});
r.post('/masters', requireRole('recruiter', 'hr'), async (req, res) => {
  const { type, name, email, phone } = req.body || {};
  if (!type || !name) return res.status(400).json({ error: 'Type and name required' });
  await run(`INSERT INTO masters(type,name,email,phone) VALUES(?,?,?,?)
       ON CONFLICT(type,name) DO UPDATE SET email=excluded.email, phone=excluded.phone, active=1`, type, name.trim(), email, phone);
  res.json({ ok: true });
});
r.delete('/masters/:id', requireRole(), async (req, res) => { await run('UPDATE masters SET active=0 WHERE id=?', req.params.id); res.json({ ok: true }); });

// ---- steps config (TAT, doer) ----
r.get('/steps', async (req, res) => res.json(await getSteps()));
r.put('/steps/:code', requireRole(), async (req, res) => {
  const { tat_days, doer_role, doer_user_id, name, short_name, how, active } = req.body || {};
  await run(`UPDATE steps SET tat_days=COALESCE(?,tat_days), doer_role=COALESCE(?,doer_role), doer_user_id=?, name=COALESCE(?,name),
       short_name=COALESCE(?,short_name), how=COALESCE(?,how), active=COALESCE(?,active) WHERE code=?`,
    tat_days, doer_role, doer_user_id || null, name, short_name, how, active, req.params.code);
  res.json({ ok: true });
});

// ---- holidays ----
r.get('/holidays', async (req, res) => res.json(await all('SELECT * FROM holidays ORDER BY date')));
r.post('/holidays', requireRole('hr'), async (req, res) => {
  await run('INSERT INTO holidays(date,name) VALUES(?,?) ON CONFLICT(date) DO UPDATE SET name=excluded.name', req.body.date, req.body.name);
  res.json({ ok: true });
});
r.delete('/holidays/:date', requireRole('hr'), async (req, res) => { await run('DELETE FROM holidays WHERE date=?', req.params.date); res.json({ ok: true }); });

// ---- templates ----
r.get('/templates', async (req, res) => res.json(await all('SELECT * FROM templates ORDER BY channel, name')));
r.put('/templates/:key', requireRole('recruiter', 'hr'), async (req, res) => {
  const { name, subject, body, channel } = req.body || {};
  await run(`INSERT INTO templates(key,name,channel,subject,body) VALUES(?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET name=excluded.name, subject=excluded.subject, body=excluded.body, channel=excluded.channel`,
    req.params.key, name, channel || 'whatsapp', subject || '', body);
  res.json({ ok: true });
});

// ---- settings ----
const PUBLIC_SETTINGS = ['company_name', 'office_address', 'public_url', 'work_start_hour', 'work_end_hour', 'weekly_off', 'whatsapp_mode', 'whatsapp_phone_id',
  'smtp_host', 'smtp_port', 'smtp_user', 'smtp_from', 'smtp_secure', 'ai_model', 'escalation_hours', 'email_provider',
  'auto_screen', 'screen_accept', 'screen_reject', 'auto_reject', ...Object.keys(AGENTS).map((a) => `ai_enabled_${a}`)];
const SECRET_SETTINGS = ['anthropic_api_key', 'smtp_pass', 'whatsapp_token', 'email_api_key'];

r.get('/settings', requireRole(), async (req, res) => {
  const out = {};
  for (const k of PUBLIC_SETTINGS) out[k] = await setting(k, '');
  for (const k of SECRET_SETTINGS) out[k] = (await setting(k)) ? '••••••••' : '';
  out.ai_available = await aiAvailable();
  out.ai_env_key = !!process.env.ANTHROPIC_API_KEY;
  out.agents = AGENTS;
  out.inbound_url = `${await setting('public_url', '')}/api/public/inbound/${await setting('inbound_token', '')}`;
  if (!out.auto_screen) out.auto_screen = 'score';
  if (!out.screen_accept) out.screen_accept = '70';
  if (!out.screen_reject) out.screen_reject = '30';
  res.json(out);
});
r.put('/settings', requireRole(), async (req, res) => {
  for (const [k, v] of Object.entries(req.body || {})) {
    if (PUBLIC_SETTINGS.includes(k)) await setSetting(k, v ?? '');
    if (SECRET_SETTINGS.includes(k) && v && v !== '••••••••') await setSetting(k, v);
  }
  res.json({ ok: true });
});

export default r;
