import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { get, setting, setSetting } from './db.js';

function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  let s = setting('jwt_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('jwt_secret', s); }
  return s;
}

export const ROLES = {
  admin: 'Admin (all access)',
  recruiter: 'Recruiter (Inward + Outward)',
  hr: 'HR (Onboarding)',
  pc: 'PC – Process Coordinator (verification)',
  approver: 'Approver (Ritesh Sir – hold decisions)',
  hod: 'HOD / Manager (raise requirement, approve JD)',
  ea: 'EA (MIS scoring)',
  accounts: 'Accounts (agency payment)',
};

export const hashPassword = (p) => bcrypt.hashSync(p, 10);
export const checkPassword = (p, h) => bcrypt.compareSync(p, h);
export const signToken = (u) => jwt.sign({ id: u.id, role: u.role }, secret(), { expiresIn: '7d' });

export function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  try {
    const p = jwt.verify(token, secret());
    const u = get('SELECT id, name, email, phone, role, active FROM users WHERE id=?', p.id);
    if (!u || !u.active) return res.status(401).json({ error: 'User disabled' });
    req.user = u;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please login again' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  req.user && (req.user.role === 'admin' || roles.includes(req.user.role)) ? next() : res.status(403).json({ error: 'Not allowed for your role' });
