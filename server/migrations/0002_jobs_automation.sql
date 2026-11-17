-- Job posting, platforms, automations, message outbox

CREATE TABLE IF NOT EXISTS platforms (
  name TEXT PRIMARY KEY,              -- same text as candidates.source
  method TEXT NOT NULL,               -- careers | email | assisted | api | whatsapp
  post_url TEXT,                      -- employer page to post a job (assisted)
  email TEXT,                         -- consultancy email (email method)
  api_url TEXT,                       -- api method: JSON POST endpoint (partner API / Zapier / Make)
  api_key TEXT,
  cost_note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 50
);

CREATE TABLE IF NOT EXISTS job_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  requirement_id INTEGER NOT NULL REFERENCES requirements(id),
  platform TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'auto',  -- auto | assisted | manual
  status TEXT NOT NULL DEFAULT 'Pending', -- Pending | Posted | Failed | Closed
  post_url TEXT,
  apply_link TEXT,
  error TEXT,
  posted_at TEXT,
  posted_by INTEGER,
  closed_at TEXT,
  created_at TEXT,
  UNIQUE(requirement_id, platform)
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event TEXT NOT NULL,                -- e.g. S04:Accepted, candidate.created, cron.interview_reminder
  name TEXT NOT NULL,
  channel TEXT NOT NULL,              -- whatsapp | email
  recipient TEXT NOT NULL,            -- candidate | consultancy | approver | recruiter | hod | doer
  template_key TEXT NOT NULL,
  complete_step TEXT,                 -- step code auto-completed when the message is sent
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(event, channel, recipient, template_key)
);

ALTER TABLE messages ADD COLUMN automation TEXT;
ALTER TABLE messages ADD COLUMN link TEXT;
ALTER TABLE messages ADD COLUMN sent_at TEXT;
ALTER TABLE messages ADD COLUMN related_type TEXT;
ALTER TABLE messages ADD COLUMN related_id INTEGER;

ALTER TABLE candidates ADD COLUMN interview_reminded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE candidates ADD COLUMN channel TEXT;   -- how the application arrived: manual | careers | webhook | import | resume-bulk

CREATE INDEX IF NOT EXISTS idx_cand_created ON candidates(created_at);
CREATE INDEX IF NOT EXISTS idx_si_actual ON step_instances(step_code, actual_at);
CREATE INDEX IF NOT EXISTS idx_si_planned ON step_instances(step_code, planned_at);
CREATE INDEX IF NOT EXISTS idx_msg_status ON messages(status);
