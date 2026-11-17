// First-run setup: default users, master lists and settings taken from FMS-26.
// Run directly (`npm run seed`) to reset users' passwords to defaults.
import { fileURLToPath } from 'node:url';
import { run, get, setSetting, setting } from './db.js';
import { hashPassword } from './auth.js';
import { seedSteps } from './workflow.js';
import { seedTemplates } from './notify.js';

export const DEFAULT_USERS = [
  { name: 'Admin', email: 'admin@epil.local', role: 'admin', password: 'admin123' },
  { name: 'Khushi Gosai', email: 'khushi@epil.local', role: 'recruiter', password: 'epil@123' },
  { name: 'Meet (HR Onboarding)', email: 'meet@epil.local', role: 'hr', password: 'epil@123' },
  { name: 'Maitri (Buddy / Accounts)', email: 'maitri@epil.local', role: 'accounts', password: 'epil@123' },
  { name: 'Sapna (EA – MIS)', email: 'sapna@epil.local', role: 'ea', password: 'epil@123' },
  { name: 'PC1', email: 'pc1@epil.local', role: 'pc', password: 'epil@123' },
  { name: 'Ritesh Sir', email: 'ritesh@epil.local', role: 'approver', password: 'epil@123' },
  { name: 'Aman Sir (HOD)', email: 'aman@epil.local', role: 'hod', password: 'epil@123' },
];

export const MASTERS = {
  company: ['EPIL KOSAMBA', 'EPIL KATARGAM', 'ATM KATARGAM', 'SWASTIK SACHIN', 'RACHNA PANDESARA', 'AEROWAVES LLP', 'Radhadarshan Green LLP', 'SPACEBOX WAREHOUSING LLP'],
  requester: ['AMAN SIR', 'RITESH SIR', 'KANISHK SIR', 'VIDHUT SIR', 'NAVEEN SIR', 'AYUSH SIR', 'SAPNA MAM', 'APOORVA MAM', 'RAVI SIR', 'BINAY SIR'],
  department: ['Accounts', 'Admin', 'HR', 'Production', 'Quality', 'Maintenance / Utility', 'Sales & Marketing', 'Purchase', 'Stores / Warehouse', 'IT', 'Design', 'Logistics'],
  source: [
    ['WORK INDIA', 'recruiter@epil.biz'], ['APNA JOB', 'recruiter@epil.biz'], ['LINKEDIN', 'recruiter@epil.biz'], ['STAFF REFERENCE', 'recruiter@epil.biz'],
    ['NILESH BAROT', 'Consultant_nilesh@yahoo.com'], ['PLEASANT INC', 'hr@pleasantinc.com'], ['KAMKAJ RECRUITMENT', 'Kamkajplacement@gmail.com'],
    ['U N PLACEMENT', 'un.jobplacement@gmail.com'], ['RISHI JOBS', 'client@rishijobs.in'], ['CAREERS PAGE / WALK-IN', null],
  ],
};

export function seedMasters() {
  for (const [type, list] of Object.entries(MASTERS)) {
    for (const item of list) {
      const [name, email] = Array.isArray(item) ? item : [item, null];
      run('INSERT INTO masters(type,name,email) VALUES(?,?,?) ON CONFLICT(type,name) DO NOTHING', type, name, email);
    }
  }
}

export function bootstrap() {
  seedSteps();
  seedTemplates();
  for (const u of DEFAULT_USERS) {
    run('INSERT INTO users(name,email,role,password_hash) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET password_hash=excluded.password_hash',
      u.name, u.email, u.role, hashPassword(u.password));
  }
  seedMasters();
  const defaults = { company_name: 'EPIL Group', public_url: 'http://localhost:4000', work_start_hour: '9', work_end_hour: '19', weekly_off: '0', whatsapp_mode: 'link', escalation_hours: '48', ai_model: 'claude-opus-5-5' };
  for (const [k, v] of Object.entries(defaults)) if (setting(k) === null) setSetting(k, v);
  // Assign fixed doers so tasks show the right person
  const byEmail = (e) => get('SELECT id FROM users WHERE email=?', e)?.id;
  run(`UPDATE steps SET doer_user_id=? WHERE doer_role='recruiter' AND doer_user_id IS NULL`, byEmail('khushi@epil.local'));
  console.log('Default users created. Admin login: admin@epil.local / admin123 (others: epil@123)');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) bootstrap();
