-- EPIL Recruitment Portal schema
-- SQLite dialect: runs as-is on Cloudflare D1. For MySQL change
-- INTEGER PRIMARY KEY AUTOINCREMENT -> INT AUTO_INCREMENT PRIMARY KEY and TEXT dates -> DATETIME.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,              -- admin | recruiter | hr | pc | approver | hod | ea | accounts
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Master lists (company, source, requester, designation, department)
CREATE TABLE IF NOT EXISTS masters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,              -- company | source | requester | designation
  name TEXT NOT NULL,
  email TEXT,                      -- consultancy email for sources
  phone TEXT,
  meta TEXT,                       -- JSON (e.g. cost per post)
  active INTEGER NOT NULL DEFAULT 1,
  UNIQUE(type, name)
);

-- Workflow step definitions (editable from Settings)
CREATE TABLE IF NOT EXISTS steps (
  code TEXT PRIMARY KEY,           -- S01 .. S27
  no INTEGER NOT NULL,
  stage TEXT NOT NULL,             -- inward | outward | onboarding
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  doer_role TEXT NOT NULL,
  doer_user_id INTEGER,            -- optional fixed person
  how TEXT,
  tat_days REAL NOT NULL DEFAULT 1,
  anchor TEXT NOT NULL DEFAULT 'prev', -- prev | joining
  options TEXT NOT NULL,           -- JSON [{value,label,effect,next}]
  fields TEXT,                     -- JSON extra inputs
  optional INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS holidays (
  date TEXT PRIMARY KEY,
  name TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- INWARD: vacancy requests
CREATE TABLE IF NOT EXISTS requirements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                -- IN-166
  request_date TEXT NOT NULL,
  company TEXT NOT NULL,
  designation TEXT NOT NULL,
  department TEXT,
  salary_range TEXT,
  openings INTEGER NOT NULL DEFAULT 1,
  requirement_by TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'Normal', -- Urgent | High | Normal | Low
  target_date TEXT,
  experience TEXT,
  qualification TEXT,
  skills TEXT,
  location TEXT,
  notes TEXT,
  jd_text TEXT,
  jd_status TEXT NOT NULL DEFAULT 'Draft', -- Draft | Sent for approval | Approved
  status TEXT NOT NULL DEFAULT 'Open',      -- Open | On Hold | Closed | Cancelled
  filled INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);

-- OUTWARD: candidates sourced against a requirement
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                -- OUT-2891
  requirement_id INTEGER REFERENCES requirements(id),
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  email TEXT,
  source TEXT NOT NULL,
  consultancy_email TEXT,
  current_company TEXT,
  experience_years REAL,
  current_ctc TEXT,
  expected_ctc TEXT,
  notice_period TEXT,
  location TEXT,
  qualification TEXT,
  skills TEXT,
  resume_path TEXT,
  resume_url TEXT,
  resume_text TEXT,
  ai_score INTEGER,
  ai_summary TEXT,
  ai_questions TEXT,
  interview_at TEXT,
  interviewer TEXT,
  joining_date TEXT,
  offered_salary TEXT,
  stage TEXT NOT NULL DEFAULT 'Screening',
  status TEXT NOT NULL DEFAULT 'Active',   -- Active | Rejected | Dropped | Selected | Joined | Not Joined | Future Hold
  apply_token TEXT UNIQUE,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cand_mobile ON candidates(mobile);
CREATE INDEX IF NOT EXISTS idx_cand_req ON candidates(requirement_id);

-- ONBOARDING: selected candidates
CREATE TABLE IF NOT EXISTS onboardings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,                -- ONB-144
  candidate_id INTEGER NOT NULL UNIQUE REFERENCES candidates(id),
  joining_date TEXT,
  department TEXT,
  buddy TEXT,
  checklist TEXT,                  -- JSON {item:true}
  agency_payment REAL,
  status TEXT NOT NULL DEFAULT 'Pre-Onboarding', -- Pre-Onboarding | Joined | Not Joined | Active | Left | Retained 90
  left_on TEXT,
  left_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per (record, step). UNIQUE stops the duplicate log problem of Studio-2.0.
CREATE TABLE IF NOT EXISTS step_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,       -- requirement | candidate | onboarding
  entity_id INTEGER NOT NULL,
  step_code TEXT NOT NULL REFERENCES steps(code),
  planned_at TEXT,
  actual_at TEXT,
  state TEXT NOT NULL DEFAULT 'pending', -- pending | done | skipped | cancelled
  result TEXT,
  remark TEXT,
  data TEXT,                       -- JSON extra field values
  delay_hours REAL,
  done_by INTEGER,
  follow_ups INTEGER NOT NULL DEFAULT 0,
  last_follow_up TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, entity_id, step_code)
);
CREATE INDEX IF NOT EXISTS idx_si_state ON step_instances(state, planned_at);

-- Audit / activity timeline
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  detail TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_act_entity ON activity(entity_type, entity_id);

-- WhatsApp / Email log
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER,
  channel TEXT NOT NULL,           -- whatsapp | email
  to_addr TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  template TEXT,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | opened-link | failed
  error TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS templates (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL
);

-- Job-portal spend (Apna, Work India, LinkedIn...)
CREATE TABLE IF NOT EXISTS portal_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  post_name TEXT,
  posted_date TEXT,
  closed_date TEXT,
  amount REAL NOT NULL DEFAULT 0,
  invoice TEXT,
  requirement_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI agent run log
CREATE TABLE IF NOT EXISTS ai_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  input TEXT,
  output TEXT,
  mode TEXT,                       -- claude | offline
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Uploaded files (used on Cloudflare when no R2 bucket is bound)
CREATE TABLE IF NOT EXISTS files (
  name TEXT PRIMARY KEY,
  type TEXT,
  size INTEGER,
  data BLOB NOT NULL,
  created_at TEXT
);
