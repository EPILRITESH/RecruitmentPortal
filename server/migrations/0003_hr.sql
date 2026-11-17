-- HR: employees, shifts, biometric devices & punches, daily attendance, leave, payroll

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_time TEXT NOT NULL DEFAULT '09:00',   -- HH:MM
  end_time TEXT NOT NULL DEFAULT '19:00',
  break_minutes INTEGER NOT NULL DEFAULT 60,
  grace_minutes INTEGER NOT NULL DEFAULT 10,  -- late after start + grace
  early_grace_minutes INTEGER NOT NULL DEFAULT 10,
  full_day_hours REAL NOT NULL DEFAULT 8,     -- worked hours for Present
  half_day_hours REAL NOT NULL DEFAULT 4,     -- worked hours for Half day
  ot_after_minutes INTEGER NOT NULL DEFAULT 30, -- OT counts only beyond shift end + this
  ot_round_minutes INTEGER NOT NULL DEFAULT 30,
  weekly_off TEXT NOT NULL DEFAULT '0',       -- 0=Sun … 6=Sat, comma separated
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mobile TEXT,
  email TEXT,
  gender TEXT,
  dob TEXT,
  company TEXT,
  department TEXT,
  designation TEXT,
  location TEXT,
  joining_date TEXT,
  exit_date TEXT,
  status TEXT NOT NULL DEFAULT 'Active',      -- Active | On Notice | Left
  employment_type TEXT DEFAULT 'Permanent',   -- Permanent | Probation | Contract | Trainee
  shift_id INTEGER REFERENCES shifts(id),
  biometric_id TEXT,                           -- user / enroll no. on the device
  user_id INTEGER REFERENCES users(id),        -- portal login (self-service)
  manager_user_id INTEGER REFERENCES users(id),-- leave approver (optional; HR/admin can always approve)
  candidate_id INTEGER,                        -- link to recruitment
  salary_type TEXT NOT NULL DEFAULT 'monthly', -- monthly | daily | hourly
  gross_salary REAL NOT NULL DEFAULT 0,        -- monthly gross / daily rate / hourly rate
  ot_allowed INTEGER NOT NULL DEFAULT 1,
  pf_applicable INTEGER NOT NULL DEFAULT 0,
  esic_applicable INTEGER NOT NULL DEFAULT 0,
  pt_applicable INTEGER NOT NULL DEFAULT 1,
  bank_name TEXT, account_no TEXT, ifsc TEXT, pan TEXT, aadhaar TEXT, uan TEXT, esic_no TEXT,
  address TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_emp_bio ON employees(biometric_id);
CREATE INDEX IF NOT EXISTS idx_emp_user ON employees(user_id);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  serial_no TEXT UNIQUE,                      -- ZKTeco / eSSL serial (ADMS push)
  kind TEXT NOT NULL DEFAULT 'adms',          -- adms | api | import
  location TEXT,
  active INTEGER NOT NULL DEFAULT 0,          -- new devices wait for admin approval
  last_seen TEXT,
  last_ip TEXT,
  punches INTEGER NOT NULL DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS punches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  biometric_id TEXT NOT NULL,
  employee_id INTEGER,
  punch_time TEXT NOT NULL,                   -- IST "YYYY-MM-DD HH:MM:SS"
  device TEXT,
  source TEXT NOT NULL DEFAULT 'device',      -- device | api | import | manual
  direction TEXT,                             -- in | out | null
  created_at TEXT,
  UNIQUE(biometric_id, punch_time)
);
CREATE INDEX IF NOT EXISTS idx_punch_emp ON punches(employee_id, punch_time);

CREATE TABLE IF NOT EXISTS attendance (
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,                          -- YYYY-MM-DD
  first_in TEXT,
  last_out TEXT,
  punch_count INTEGER NOT NULL DEFAULT 0,
  work_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_minutes INTEGER NOT NULL DEFAULT 0,
  ot_minutes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,                        -- P | HD | A | WO | H | L | HL(half leave) | WOP | HP | MP(missed punch)
  leave_code TEXT,
  remark TEXT,
  manual INTEGER NOT NULL DEFAULT 0,           -- 1 = set by HR, not overwritten by processing
  updated_at TEXT,
  PRIMARY KEY (employee_id, date)
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);

CREATE TABLE IF NOT EXISTS attendance_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  date TEXT NOT NULL,
  in_time TEXT,
  out_time TEXT,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',      -- Pending | Approved | Rejected
  decided_by INTEGER, decided_at TEXT, remark TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS leave_types (
  code TEXT PRIMARY KEY,                       -- CL, SL, EL, LWP, CO
  name TEXT NOT NULL,
  paid INTEGER NOT NULL DEFAULT 1,
  annual_quota REAL NOT NULL DEFAULT 0,
  accrual TEXT NOT NULL DEFAULT 'yearly',      -- yearly | monthly
  carry_forward_max REAL NOT NULL DEFAULT 0,
  allow_half_day INTEGER NOT NULL DEFAULT 1,
  allow_negative INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS leave_adjustments (       -- opening balance, carry forward, comp-off credit, manual +/-
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  leave_code TEXT NOT NULL,
  year INTEGER NOT NULL,
  days REAL NOT NULL,
  note TEXT,
  created_by INTEGER, created_at TEXT
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  leave_code TEXT NOT NULL,
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  half_day TEXT,                               -- null | first | second (only when from=to)
  days REAL NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',      -- Pending | Approved | Rejected | Cancelled
  applied_by INTEGER,
  decided_by INTEGER, decided_at TEXT, decision_remark TEXT,
  created_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leave_emp ON leave_requests(employee_id, from_date);

CREATE TABLE IF NOT EXISTS salary_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,                         -- YYYY-MM
  kind TEXT NOT NULL,                          -- bonus | incentive | arrear | allowance | advance | loan | fine | tds | other_deduction
  amount REAL NOT NULL,
  note TEXT,
  created_by INTEGER, created_at TEXT
);

CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month TEXT NOT NULL,
  company TEXT,                                -- null = all companies
  status TEXT NOT NULL DEFAULT 'Draft',        -- Draft | Locked | Paid
  employees INTEGER NOT NULL DEFAULT 0,
  gross REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  created_by INTEGER, created_at TEXT, locked_at TEXT,
  UNIQUE(month, company)
);

CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id),
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  month TEXT NOT NULL,
  data TEXT NOT NULL,                          -- JSON: attendance summary, earnings[], deductions[], employer[]
  gross REAL NOT NULL DEFAULT 0,
  deductions REAL NOT NULL DEFAULT 0,
  net REAL NOT NULL DEFAULT 0,
  paid_days REAL NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  created_at TEXT,
  UNIQUE(run_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_payslip_emp ON payslips(employee_id, month);

ALTER TABLE messages ADD COLUMN employee_id INTEGER;
