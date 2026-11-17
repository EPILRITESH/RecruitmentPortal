import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { get, setting, setSetting } from './db.js';

let cachedSecret = null;
async function secret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (cachedSecret) return cachedSecret;
  let s = await setting('jwt_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); await setSetting('jwt_secret', s); }
  cachedSecret = s;
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

// PBKDF2-SHA256 (native crypto, fast enough for Workers CPU limits)
const ITER = 10000; // kept low to stay inside the Workers free-plan CPU limit
export function hashPassword(p) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(p), salt, ITER, 32, 'sha256').toString('hex');
  return `pbkdf2$${ITER}$${salt}$${hash}`;
}
export function checkPassword(p, stored) {
  if (!stored) return false;
  if (stored.startsWith('pbkdf2$')) {
    const [, iter, salt, hash] = stored.split('$');
    const h = crypto.pbkdf2Sync(String(p), salt, Number(iter), 32, 'sha256').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(hash, 'hex'));
  }
  return bcrypt.compareSync(String(p), stored); // older bcrypt hashes
}
export const signToken = async (u) => jwt.sign({ id: u.id, role: u.role }, await secret(), { expiresIn: '7d' });

export async function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: 'Login required' });
  let p;
  try {
    p = jwt.verify(token, await secret());
  } catch {
    return res.status(401).json({ error: 'Session expired, please login again' });
  }
  try {
    const u = await get('SELECT id, name, email, phone, role, active FROM users WHERE id=?', p.id);
    if (!u || !u.active) return res.status(401).json({ error: 'User disabled' });
    req.user = u;
    next();
  } catch (e) { next(e); }
}

export const requireRole = (...roles) => (req, res, next) =>
  req.user && (req.user.role === 'admin' || roles.includes(req.user.role)) ? next() : res.status(403).json({ error: 'Not allowed for your role' });
