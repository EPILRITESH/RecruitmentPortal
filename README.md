# EPIL Recruitment Portal (FMS-26 → Web)

The FMS-26 Google Sheet, Google Forms and Looker Studio dashboard, rebuilt as one web portal with AI recruitment agents.

**Live:** https://epil-recruitment.epil.workers.dev (Cloudflare Workers + D1)

**Stack:** React 19 + Vite + Tailwind (client) · Express (server) running on **Cloudflare Workers** with a **D1** database, or on plain Node.js 22 with a local SQLite file · Claude API for the AI agents.

---

## 1. Run it

Requires **Node.js 22.13 or newer**.

```bash
npm run install:all      # installs server + client
npm run build            # builds the React app
npm start                # http://localhost:4000
```

A fresh **local** database starts with these default users (the live site uses different, strong passwords):

| Login | Password | Role |
|---|---|---|
| admin@epil.local | admin123 | Admin |
| khushi@epil.local | epil@123 | Recruiter (Inward + Outward doer) |
| meet@epil.local | epil@123 | HR – onboarding |
| pc1@epil.local | epil@123 | PC – verification steps |
| ritesh@epil.local | epil@123 | Approver – hold decisions |
| maitri@epil.local | epil@123 | Accounts – agency payment |
| sapna@epil.local | epil@123 | EA – MIS scoring |
| aman@epil.local | epil@123 | HOD – raises requirements, approves JD |

Change the passwords in **Settings → Users** before going live.

**Development (hot reload):** run `npm run dev:server` and `npm run dev:client` in two terminals. The client opens at http://localhost:5173.

### Import your existing FMS-26 data

Download the Google Sheet as `.xlsx`, then:

```bash
npm run import:fms -- "/path/to/FMS-26 RECRUITMENT 2026.xlsx" --reset
```

The importer reads INWARD FMS, OUTWARD FMS, ONBOARDING FMS, Portal Payment and Holidays. Every step keeps its planned date, actual date and result, so delay history is preserved. A test import of the current sheet gave 73 requirements, 1,719 candidates, 91 joinees and 11 portal payments.

Old steps that were never closed in the sheet come in as pending tasks. If you want a clean start, add `--skip-backlog-before=2026-11-01`: pending steps planned before that date are marked "skipped".

### AI agents

Add an Anthropic API key in **Settings → AI**, or set `ANTHROPIC_API_KEY` in `server/.env` (see `.env.example`). Default model: `claude-opus-5-5`. Each agent can be switched on or off. Without a key, every agent falls back to simple offline rules (template JD, regex CV reading, keyword match), so the portal still works.

---

## 2. What changed from the sheet

| FMS-26 (Google) | Portal |
|---|---|
| Inward Google Form | **New requirement** form (HODs can log in themselves) |
| JD written by hand | **AI JD Generator** + HOD approval button + short job post for Work India / Apna / WhatsApp |
| Outward Google Form | **Add candidate**: upload a resume and the **AI CV Parser** fills the form. Duplicate mobiles are flagged. |
| Candidate fills Google Form / printout | A **personal form link** sent on WhatsApp. Step 6 ticks itself when the candidate submits. |
| Looker → update each step | **My Tasks**: one click on a result stamps the actual time, calculates the delay and creates the next step |
| Studio-2.0 log (DUPLICATE rows) | One row per step per record, enforced by a database `UNIQUE` key |
| Rescue Sheet | **Rescue Board**: late work grouped by doer, follow-up log, escalation after 48 h |
| Hold → call Ritesh Sir | Step 9 goes straight into Ritesh Sir's own task list |
| Email to consultancy by hand | One-click selection email (consultancy email comes from the source master) |
| ONBOARDING FMS, checklists | Onboarding record created automatically on final select. All steps are planned from the joining date. |
| RETENTION, PORTAL SUMMARY, Conversion Rate, Looker | **Reports & MIS** (live): funnel, source cost per joinee, step on-time %, retention, weekly portal summary, CSV export |
| `#REF!`, `#N/A`, 30/12/1899 dates | Gone: everything is computed in SQL, and blank dates stay blank |
| Swapped / blank step names, name mismatches | One official step list (Settings → Steps). You can fix a doer per step. |


## 2b. Job posting, intake, screening and automation (added Nov 2026)

**Job posting (Requirement page → Job posting).** Once the JD is approved, tick platforms and press **Post**:

| Platform type | What the portal does |
|---|---|
| Careers page | Publishes immediately at `/careers` (each job also has its own link) |
| Consultancies (Nilesh Barot, U N Placement, Rishi Jobs…) | Emails the JD + apply link automatically (needs an email provider), else opens it in your mail app |
| API (any platform / Zapier / Make with an endpoint) | POSTs the job as JSON automatically |
| Work India, Apna, LinkedIn, Naukri, Indeed | *Assisted*: these sites have no open posting API for employers, so the portal copies the post text, opens the site, and you confirm with the job link |
| Staff reference | WhatsApp share |

Posting marks **Step 1 (JD)** and **Step 2 (enquiry posted)** done with the actual time. There is also **Record manual post**.

**Applications into the portal.** Every platform gets its own apply link (`/careers?job=IN-170&src=WORK%20INDIA`), so applicants land tagged with the right source. Other routes:
- **Webhook** for platforms, Zapier or Make. The URL is in Settings → Screening & applications.
- **Import Excel/CSV** of applicant exports. Duplicates are skipped.
- **Upload many resumes.** The CV parser creates each candidate.
- **Manual add**, as before.

**Screening.** Auto (Settings: off / score only / score and complete Step 4 above a threshold), manual (candidate page), or bulk (tick candidates → Run screening / Accept / Reject).

**Automations (Settings → Automations).** Rules such as "screening accepted → WhatsApp interest message", "interested → form link", "interview scheduled → invite + reminder the day before", "hold → email Ritesh Sir", "selected → message + consultancy email (completes Step 12)", "joined → welcome", "6-day check → feedback link", and a daily task email to every doer.
- With the **WhatsApp Cloud API** and an **email provider** (Brevo or Resend) set in Settings → Communication, these messages go out by themselves.
- Without them, messages wait in the **Outbox**, where each one is sent with one click.

**Plan vs Actual (FMS view).** The sheet layout: rows are records, columns are steps, and each cell shows Planned, Actual and status. Click a pending cell to complete it.

**MIS Dashboard** (Looker replacement), with week / month / date-range and company / platform filters:
- Actual: Inward, Inward pending, Outward, Screening, Interview, Selection, Retention (with plan and %)
- Actual onboarding: HR orientation, Accessories, MIS scoring, Training, 30/60-day checks
- Plan vs Actual for every step
- 5×3 report by week or month × platform: outward, interview and selection
- Placement summary with names, agency and portal spend
- Retention by joining month with names
- Full list of outward candidates

Every number opens the list of names behind it.


## 2c. HR: employees, attendance, leave, payroll (added Nov 2026)

| Area | What it does |
|---|---|
| **Employees** (HR & Payroll → Employees) | Employee master: company, department, shift, biometric ID, salary (monthly / daily / hourly), PF / ESIC / PT, bank, PAN, UAN. Excel import (existing code = update). Recruitment joinees (Step 15 = Joined) become employees automatically. Headcount by company / department. |
| **Biometric attendance** | (1) ZKTeco / eSSL machines with the *ADMS / Cloud server* option push punches straight to `/iclock/cdata` (approve the machine once). (2) Any other software or a sync script can POST punches to the private URL shown in Attendance → Machines & integration. (3) Excel / CSV import of punch logs or daily in/out sheets. (4) HR can edit any day. |
| **Daily processing** | Per shift: first in / last out, worked hours, late (with grace), early going, overtime (after shift end + N minutes, rounded), half day / full day thresholds, missed punch, weekly off, holiday, approved leave, night shifts. Runs on every punch and hourly; yesterday is closed at about 10 AM with an HR summary email. |
| **Leave** | Leave types and quota (pro-rated, monthly or yearly credit, half day, without-pay type). Employees apply from their own login; HR / admin / reporting manager approve or reject. WhatsApp and email go out on apply and on decision, and attendance updates automatically. Attendance correction (missed punch) requests work the same way. |
| **Payroll** | Paid days from attendance (calendar / 30 / 26-day basis, paid weekly off and holidays, sandwich rule, late-mark penalty), earnings split (Basic %, HRA %, special allowance), overtime (single / double, on gross or basic, monthly cap), PF, ESIC and Gujarat PT slabs, plus adjustments (bonus, incentive, arrears, advance, loan, fine, TDS). Draft → Lock → Publish (employees notified) → Paid. Salary register and bank transfer CSV. Printable salary slip with amount in words. |
| **Self-service** | Role `employee`. They sign in with their mobile number and see only their own attendance calendar, leave balance and requests, corrections and published salary slips. |

All rules are in **HR settings** (shifts, attendance and salary rules, leave types). Holidays are shared with recruitment (Settings → Holidays).

**Machine connection notes.** On the free `*.workers.dev` address Cloudflare always runs a browser check, and plain-HTTP behaviour isn't documented, so some machines may fail to connect directly. For reliable direct connection, put the Worker on your own domain (Cloudflare → Workers → Custom domain). Otherwise use the punch API or Excel import.

## 3. The workflow (single official step list)

| # | Step | Doer | TAT |
|---|---|---|---|
| **Inward** | | | |
| 1 | Checklist updated & JD prepared (HOD approval) | Recruiter | same day |
| 2 | Enquiry posted on job portals | Recruiter | 3 working days |
| 3 | PC verification | PC | 1 |
| **Outward** | | | |
| 4 | Screening: Accepted / Rejected | Recruiter | same day |
| 5 | Interested or not | Recruiter | 3 |
| 6 | Form filled / resume attached (auto from link) | Recruiter | 4 |
| 7 | Came for interview? (Rescheduled keeps the step open) | Recruiter | 2 |
| 8 | Interview result: Selected / Hold / Rejected / Future Hold | Recruiter | 10 |
| 9 | *Hold only:* decision by Ritesh Sir | Approver | 15 |
| 10 | *Hold only:* 2nd interview | Recruiter | 15 |
| 11 | Final select / reject (asks for joining date) creates the onboarding record | Recruiter | 6 |
| 12 | Selection email to consultancy | Recruiter | 1 |
| 13 | PC verification | PC | 1 |
| **Onboarding** (days from joining date) | | | |
| 14 | Pre-onboarding | HR | −2 |
| 15 | Day 1: joined? orientation / induction | HR | 0 |
| 16 | Joining form & documentation | HR | +2 |
| 17 | Company accessories | HR | +2 |
| 18 | Training | HR | +6 |
| 19 | 6-day follow-up | HR | +6 |
| 20 | Candidate feedback form (public link) | HR | +7 |
| 21 | MIS scoring | EA | +8 |
| 22 | Placement agency payment | Accounts | +75 |
| 23/24/25 | 30 / 60 / 90-day retention check | HR | +30/+60/+90 |
| 26 | PC verification | PC | +91 |

Planning skips Sundays and the holidays you add in Settings. A rejection or drop at any step closes the candidate and cancels the remaining steps. "Did not join" or "Left" closes the onboarding record but keeps the payment and PC steps. When the openings are filled, the requirement closes automatically.

TAT, doer role and fixed person can all be changed in **Settings → Steps & TAT**.

## 4. Public pages (no login)

- `/careers`: open jobs, with a short apply form. Share the link or print it as a QR code for walk-ins.
- `/apply/<token>`: the candidate's personal form (Step 6)
- `/feedback/<token>`: joinee feedback (Step 20)

Set **Settings → Portal public URL** to your real domain so WhatsApp links point to the right place.

## 5. WhatsApp & Email

- **WhatsApp, "link" mode (default, free):** opens WhatsApp Web or the app with the message typed in. You press send.
- **WhatsApp Cloud API mode:** sends directly. Needs a Meta phone-number ID and token in Settings.
- **Email:** any SMTP server, e.g. Gmail with an app password. Without SMTP, the email opens in your mail app.
- Message templates are editable in Settings and use `{{name}}`, `{{designation}}`, `{{interview_at}}` and similar.

## 6. Cloudflare deployment (live site)

| Piece | Where |
|---|---|
| Worker | `epil-recruitment`, entry `server/src/worker.js` (Express via `httpServerHandler`) |
| Database | D1 `epil-recruitment`, binding `DB`, schema in `server/migrations/` |
| Files (resumes, invoices) | stored in D1 (`files` table, up to ~1.9 MB each). Enable R2 and add the `FILES` binding in `wrangler.jsonc` to switch to R2 automatically. |
| React app | built into the Worker (`scripts/bundle-client.mjs` → `server/src/static-bundle.js`) |
| Secrets | `JWT_SECRET` (set), `ANTHROPIC_API_KEY` (optional: `npx wrangler secret put ANTHROPIC_API_KEY`, or paste it in Settings → AI) |

Deploy an update:

```bash
npm install && npm run install:all
npx wrangler d1 migrations apply epil-recruitment --remote   # only when schema changes
npm run deploy                                               # builds client, bundles it, wrangler deploy
```

Re-load data from the Google Sheet into the live database (this **replaces** all live data):

```bash
npm run import:fms -- "/path/to/FMS-26.xlsx" --reset
node server/src/export-d1.js > d1-data.sql
npx wrangler d1 execute epil-recruitment --remote --file d1-data.sql
```

The code runs on Node.js too: `npm start` uses `server/src/index.js`, a local SQLite file and an `uploads/` folder. All queries go through `server/src/db.js`, which has both drivers. Times are stored as India time (IST) on both runtimes.

## 7. Project layout

```
server/src/
  app.js            Express app (shared)
  worker.js         Cloudflare Workers entry (D1, static bundle)
  index.js          Node.js entry (SQLite file, serves client/dist)
  storage.js        uploads → R2 / D1 / local folder
  export-d1.js      local DB → SQL file for D1
  workflow.js       step definitions + engine (planned/actual/delay, outcomes, task list)
  ai.js             Claude agents: JD, CV parser, screening, outreach, assistant
  notify.js         WhatsApp / email + templates
  import-fms26.js   one-time Google Sheet import
  routes/           core (auth, settings), recruit, reports, public
client/src/
  pages/            Dashboard, Tasks, Rescue, Requirements, Candidates, Onboarding, AI, Reports, Payments, Settings, Guide
  public/           Careers, Apply, Feedback
  components/       UI kit, step tracker, task modal, forms, charts
```
