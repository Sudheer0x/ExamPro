# ExamPro — Phase 1: Project Setup

Sections 1–9 below describe **Phase 1** (project structure, software, npm packages,
MySQL). **Phase 2** (authentication + role-based access) is documented in the
"Phase 2" section at the end of this file.

## 1. Folder structure

```
exampro/
│
├── backend/
│   ├── server.js                 ← you run this to start the app
│   ├── package.json               ← npm dependencies (see below)
│   ├── .env.example                ← copy to .env and fill in your values
│   │
│   ├── database/
│   │   └── schema.sql             ← full MySQL schema (run this once)
│   │
│   └── src/
│       ├── app.js                 ← builds the Express app (middleware, routes)
│       │
│       ├── config/
│       │   └── database.js        ← MySQL connection pool (mysql2)
│       │
│       ├── controllers/           ← one file per feature area — request handlers
│       │   ├── authController.js
│       │   ├── registrationController.js
│       │   ├── examController.js
│       │   ├── adminController.js
│       │   ├── invigilatorController.js
│       │   └── examinerController.js
│       │
│       ├── routes/                ← maps URLs to controller functions
│       │   ├── authRoutes.js
│       │   ├── registrationRoutes.js
│       │   ├── examRoutes.js
│       │   ├── adminRoutes.js
│       │   ├── invigilatorRoutes.js
│       │   └── examinerRoutes.js
│       │
│       ├── services/              ← business logic reused across controllers
│       │   ├── otpService.js          (generate/verify OTPs)
│       │   ├── emailService.js        (send emails via Nodemailer)
│       │   ├── allocationService.js   (center/slot/PC allocation rules)
│       │   └── examService.js         (scoring, attempt state)
│       │
│       ├── middleware/
│       │   ├── authentication.js      (checks the user is logged in)
│       │   ├── authorization.js       (checks the user has the right role)
│       │   └── errorHandler.js
│       │
│       ├── models/                ← SQL query helpers, one file per table
│       │   └── README.md              (explains the approach — see below)
│       │
│       └── utils/                 ← small shared helper functions
│
└── frontend/
    ├── public/
    │   ├── css/
    │   ├── js/
    │   └── images/
    ├── student/        ← student-facing pages (register, dashboard, exam)
    ├── admin/           ← admin dashboard pages
    ├── invigilator/     ← invigilator portal pages
    └── examiner/        ← teacher/examiner question-bank pages
```

**Why controllers / routes / services / middleware are separate:**
- A **route** file only says *which URL maps to which function* — no logic.
- A **controller** function reads the request, calls a service (or a model)
  to do the real work, and sends back the response.
- A **service** holds logic that isn't tied to any one HTTP request — e.g.
  "generate an OTP" or "send an email" might be called from more than one
  controller.
- **Middleware** runs *before* a controller — e.g. "is this user logged in?"

This keeps each file small and focused, which matters once the project grows
across 10 phases.

**Why `models/` is currently just a README:** we're using plain SQL through
the `mysql2` connection pool (see `config/database.js`) instead of a full ORM
like Sequelize. It's simpler to understand when you're still learning, and
just as capable for this project's size. Each table will get its own small
query-helper file here starting in Phase 2 (e.g. `studentModel.js` with
functions like `findByEmail()`, `create()`).

## 2. Software requirements

Install these before continuing:

| Software | Recommended version | Check with |
|---|---|---|
| Node.js | 18 LTS or newer | `node -v` |
| npm | comes with Node.js | `npm -v` |
| MySQL Server | 8.0+ (MariaDB 10.6+ also works) | `mysql --version` |
| Git | any recent version | `git --version` |

A code editor like VS Code is recommended but not required.

## 3. npm packages

`backend/package.json` already lists everything the *whole* project will
need (not just Phase 1) — so you install once now and never think about it
again:

| Package | Used for |
|---|---|
| `express` | Web server / routing |
| `mysql2` | MySQL client (with Promise support, used as a connection pool) |
| `dotenv` | Loads `.env` config into `process.env` |
| `bcrypt` | Password hashing |
| `jsonwebtoken` | Signs the exam-portal login token (Phase 8) |
| `express-session` | Login sessions for admin/teacher/invigilator dashboards |
| `nodemailer` | Sends OTP and notification emails |
| `express-validator` | Validates registration form input |
| `express-rate-limit` | Throttles OTP requests |
| `cors` | Allows the frontend to call the API |
| `cookie-parser` | Reads cookies (used with sessions) |
| `morgan` | Logs each incoming request to the console |
| `qrcode` | Generates the hall ticket QR code |
| `uuid` | Generates unique IDs where needed |
| `nodemon` *(dev only)* | Auto-restarts the server while you're coding |

Install everything with:

```bash
cd backend
npm install
```

## 4. MySQL database setup

1. Create the database:
   ```bash
   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS exampro_db;"
   ```
2. Load the schema (creates all 19 tables):
   ```bash
   mysql -u root -p exampro_db < database/schema.sql
   ```
3. Verify it worked:
   ```bash
   mysql -u root -p exampro_db -e "SHOW TABLES;"
   ```
   You should see 19 tables: `users`, `students`, `email_otps`,
   `examinations`, `registrations`, `payments`, `exam_centers`, `computers`,
   `exam_slots`, `candidate_allocations`, `hall_tickets`, `questions`,
   `question_options`, `exam_attempts`, `student_answers`,
   `invigilator_verifications`, `computer_allocations`, `results`,
   `notifications`.

### Why `users` and `students` are separate tables
`users` holds staff accounts (admin / teacher / invigilator) who log in with
email + password. `students` is separate because a candidate's identity
(during registration) and their exam-day login (Registration ID + Hall
Ticket Number + Password, set up in Phase 8) work differently from a normal
staff login — keeping them apart avoids awkward nullable columns on one
shared table.

### Why `registrations` isn't just a column on `students`
A registration ties one student to *one specific examination*, and carries
its own `registration_id` / `application_id`. Keeping it as its own table
means the schema already supports a student registering for more than one
examination in the future, without changing anything.

## 5. Environment configuration

```bash
cd backend
cp .env.example .env
```

Then open `.env` and fill in:
- Your real MySQL password (`DB_PASSWORD`)
- Two random secret strings for `JWT_SECRET` and `SESSION_SECRET` (any long
  random text works for local development)
- Your email provider's SMTP details (for Gmail, you'll need an
  ["app password"](https://support.google.com/accounts/answer/185833), not
  your normal Gmail password) — this can be filled in later, right before
  Phase 3 (OTP emails), if you don't have it yet.

## 6. Start the server

```bash
cd backend
npm run dev
```

You should see:
```
✅ MySQL connection pool is ready.
🚀 ExamPro backend listening on http://localhost:5000
   Health check: http://localhost:5000/api/health
```

Open `http://localhost:5000/api/health` in your browser — you should see:
```json
{ "status": "ok", "message": "ExamPro backend is running." }
```

If instead you see `❌ Failed to start server`, the error message will tell
you what's wrong — almost always a wrong password or the database not
existing yet in `.env`.

## ✅ Phase 1 checklist

- [ ] Node.js, npm, and MySQL are installed
- [ ] `npm install` completed with no errors
- [ ] `exampro_db` database created
- [ ] `schema.sql` loaded — 19 tables exist
- [ ] `.env` created and filled in with your real MySQL password
- [ ] `npm run dev` starts without errors
- [ ] `http://localhost:5000/api/health` returns the success JSON

Phase 1 is complete — continue with the Phase 2 section below.

---

# Phase 2 — Authentication & Role-Based Access

## Upgrading an existing Phase 1 setup (do these once)

```bash
cd backend
npm install                                   # adds helmet
mysql -u root -p exampro_db < database/migrations/001_phase2_auth.sql
```

The migration is non-destructive: it widens `email_otps.otp_code` to `VARCHAR(255)` (OTPs are
stored hashed) and creates one new table, `refresh_tokens`. Fresh installs get both from
`database/schema.sql`. Then add the new settings from `.env.example` to your `.env`
(`JWT_ACCESS_EXPIRES_IN`, `REFRESH_TOKEN_DAYS`, `CORS_ORIGINS`, `RATE_LIMIT_DISABLED`) — all have
sensible defaults, and `JWT_SECRET` must be set.

Create the staff accounts (there is intentionally **no** public endpoint for this):

```bash
npm run seed:staff -- --role admin --email admin@example.com --name "Site Admin"
npm run seed:staff -- --role invigilator --email inv@example.com --name "Test Invigilator"
```

Start as usual with `npm run dev`. `GET /api/health` is unchanged.

## How authentication works

* **Two tables, one login.** Staff (`users`: admin / teacher / invigilator) and students (`students`)
  log in at the same `POST /api/auth/login`. Roles are `ADMIN`, `INVIGILATOR`, `TEACHER`, `STUDENT`.
* **Access token** — a JWT valid for 15 minutes, sent as `Authorization: Bearer <token>`. It carries only
  the account id and type. On every request the server re-reads the account from the database, so the
  **role always comes from the database**, and disabling an account takes effect immediately.
* **Refresh token** — a random value in an `HttpOnly`, `SameSite=Strict` cookie (`Secure` in production),
  restricted to `/api/auth`. Only its SHA-256 hash is stored in `refresh_tokens`. Each refresh **rotates**
  the token; presenting an already-used token revokes all of that account's sessions.
* **RBAC** — `authenticate` then `authorizeRoles('ADMIN')` (several roles allowed:
  `authorizeRoles('ADMIN', 'INVIGILATOR')`). Wrong role → `403`.
* **Exam portal later (Phase 8):** it can use its own token with a different `aud`/`typ`; normal login
  tokens are rejected there and vice versa.

## Endpoints

| Method | Path | Access | Notes |
|---|---|---|---|
| POST | `/api/auth/register` | public | body: `full_name`, `email`, `mobile_number`, `password`, optional `date_of_birth` (YYYY-MM-DD). Sends OTP. |
| POST | `/api/auth/send-otp` | public | `{email}` — resend (60 s cooldown); same reply whether or not the email exists |
| POST | `/api/auth/verify-otp` | public | `{email, otp}` — marks the email verified |
| POST | `/api/auth/login` | public | `{email, password}`; optional `account_type`: `student` or `staff` |
| POST | `/api/auth/refresh` | refresh cookie | rotates refresh token, returns a new access token |
| POST | `/api/auth/logout` | refresh cookie | revokes the refresh token, clears the cookie |
| GET | `/api/auth/me` | any logged-in user | `{id, role, email}` |
| GET | `/api/student/profile` | STUDENT | the caller's own profile only |
| GET | `/api/admin/users?page&limit&role` | ADMIN | staff accounts (never includes password hashes) |
| GET | `/api/admin/users/:id` | ADMIN | |
| GET | `/api/invigilator/profile` | INVIGILATOR | |

Responses: `{ "success": true, "message": "...", "data": {...} }` or `{ "success": false, "message": "..." }`
(validation errors also include an `errors` array). Status codes used: 200, 201, 400, 401, 403, 404, 409, 422, 429, 500.

## OTP rules

6 digits from `crypto.randomInt`; stored as an HMAC-SHA256 hash; valid 10 min; one use; max 5 wrong
attempts per code; 60 s resend cooldown; a new OTP invalidates the previous one. If SMTP is not configured
and `NODE_ENV=development`, the OTP is printed in the **server console** (development only — in production
the server refuses to start without SMTP, and the OTP is never printed or returned by the API).

## Environment variables added in Phase 2

`JWT_SECRET` (required), `JWT_ACCESS_EXPIRES_IN` (15m), `REFRESH_TOKEN_DAYS` (7), `OTP_HMAC_SECRET` (optional),
`CORS_ORIGINS`, `RATE_LIMIT_DISABLED` (local testing only), `TRUST_PROXY` (behind a proxy only).
`OTP_*` and `SMTP_*` variables from Phase 1 are now used.

## Testing it by hand (Windows PowerShell)

```powershell
$base = "http://localhost:5000/api"
function Post($path, $body, $session) {
  Invoke-RestMethod "$base$path" -Method Post -ContentType "application/json" `
    -Body ($body | ConvertTo-Json) -WebSession $session -SkipHttpErrorCheck -StatusCodeVariable sc
  "  -> HTTP $sc"
}
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession   # holds the refresh cookie

# 1. register (watch the server console for the OTP), 2. verify, 3. login
Post "/auth/register" @{ full_name="Test Student"; email="stu@example.com"; mobile_number="9876543210"; password="Passw0rd1" } $s
Post "/auth/verify-otp" @{ email="stu@example.com"; otp="123456" } $s     # use the OTP from the console
$login = Invoke-RestMethod "$base/auth/login" -Method Post -ContentType "application/json" `
  -Body (@{ email="stu@example.com"; password="Passw0rd1" } | ConvertTo-Json) -WebSession $s
$h = @{ Authorization = "Bearer $($login.data.accessToken)" }

Invoke-RestMethod "$base/student/profile" -Headers $h                      # 200
Invoke-RestMethod "$base/admin/users" -Headers $h -SkipHttpErrorCheck -StatusCodeVariable sc; $sc   # 403
Post "/auth/refresh" @{} $s                                                # new access token
Post "/auth/logout" @{} $s
```

Repeat the login with the seeded admin / invigilator accounts and call `/admin/users` and
`/invigilator/profile`. Missing header → 401; garbage token → 401; wrong role → 403.
To see rate limiting, send 6 wrong logins for one email (the 6th returns 429) — make sure
`RATE_LIMIT_DISABLED` is not `true`.

## Known limitations

* Rate-limit counters are in memory (reset on restart; not shared between several server processes).
* The `students` table has no status column, so a student's `account_status` is derived from `email_verified`
  and students cannot be suspended yet.
* Self-service "forgot password" and admin management of staff/student accounts are not part of Phase 2.
* `npm audit` warnings from Phase 1 are untouched; dependency upgrades should be done separately and tested.

---

# Phase 3A — Groundwork (migrations, tests, safer startup)

No new features: this makes the project safe to build Phase 3B/3C on.

## Commands (Windows PowerShell, from `backend/`)

```powershell
npm install                  # no new packages in 3A; only needed if node_modules is missing
npm run migrate:status       # read-only: shows what is applied / pending
npm run migrate              # applies pending migrations (001 is "adopted", not re-run)
npm test                     # runs every automated test
npm run dev                  # start the server
```

## Migrations

* Files live in `database/migrations/` (see the README there). `scripts/migrate.js` records what has run in a
  table called `schema_migrations` (created by the runner itself).
* `001_phase2_auth.sql` was applied by hand earlier. If the live database already has its changes, the runner
  records it as *adopted* and does **not** run it again. If it does not, the runner applies it.
* An applied migration that is later edited makes the runner stop. Add a new numbered file instead.
* Fresh install: run `database/schema.sql`, then `npm run migrate`.

## Database time-zone policy

Every MySQL connection is switched to one fixed offset, `DB_TIME_ZONE` (default `+05:30`). So `NOW()`,
TIMESTAMP columns, and DATETIME columns written with `NOW()` all agree. Exam slot dates/times will be wall-clock
times in this zone and compared with `NOW()` inside SQL, never with JavaScript dates. Startup checks the zone
really is applied (and refuses to start if it is not), and warns if the MySQL server's own default zone differs.

## Server behaviour

* Ctrl+C / SIGTERM: stops accepting requests, lets running ones finish, closes the MySQL pool, exits (forced after 10 s).
* An unhandled promise rejection or uncaught exception is logged and the process exits with code 1 (after the same clean shutdown).
* Logging: `morgan('dev')` in development, `combined` in production, none during tests.
* The frontend folder is found relative to the code, not the folder you start the server from.

## Tests

`npm test` uses Node's built-in test runner (no extra packages).

* `test/auth.test.js`, `test/rbac.test.js`, `test/ratelimit.test.js` — the real Express app over real HTTP, with the
  database and e-mail replaced by in-memory fakes (`test/support/harness.js`). They never touch MySQL or your data.
  They do **not** exercise the SQL in `src/models/*`; running the server against your database covers that.
* `test/migrate.test.js`, `test/timezone.test.js` — unit tests of the migration runner and the time-zone parser.

## Git

`.gitignore` ignores `.env*` (except `.env.example`), `node_modules/`, logs, and database *backups*
(`*.dump.sql`, `backup*.sql`, `exampro_backup*.sql`). `database/schema.sql` and `database/migrations/*.sql` are tracked.

---

# Phase 3B — Exam setup (admin API)

Backend only. Admins create examinations, exam centers, the PCs at each center, and exam slots. Students
get no new endpoints here (Phase 3C adds browsing and registration).

## Apply it (from `backend/`, Windows PowerShell)

```powershell
npm run migrate:status      # shows 002_phase3b_exam_setup.sql as PENDING
npm run migrate             # applies migration 002 to exampro_db
npm test                    # automated tests (no database needed)
npm run dev
```

Migration 002 adds `examinations.fee`, a unique key on slots, and six CHECK constraints. It is safe to run
twice and never drops or deletes anything. Fresh installs get the same from `schema.sql`.

## Real-database tests (optional but recommended)

```powershell
# one-time: add  TEST_DB_NAME=exampro_test  to .env   (the name MUST end in _test)
npm run test:db
```

This **drops and rebuilds** the database named in `TEST_DB_NAME`, loads `schema.sql`, applies the migrations, and
tests the real SQL, constraints, the migration upgrade path, the time-zone policy and simultaneous requests.
It refuses to run unless the name ends in `_test` and differs from `DB_NAME`, and it only starts through this
command. Your real database is never touched.

## Rules the API enforces

* **PCs.** The `computers` table is the source of truth; a PC works unless it is in `maintenance`. The counter
  columns on `exam_centers` are kept in step automatically. Bulk creation is all-or-nothing and continues the
  numbering (`PC-001 ... PC-060`, then `PC-061`).
* **Slot capacity.** All slots at a center share its PCs, so the seats of slots that overlap in time (even for
  different exams) can never add up to more than the working PCs. Slots that merely touch do not overlap.
  A PC cannot be taken out of service if that would leave upcoming slots short.
* **Slot rules.** Must start in the future; at least as long as the exam; one slot per exam + center + date +
  start time; only while the exam is draft, open or closed. Slots **may be created before registration closes**,
  including while registration is open (students choose a slot while registering); there is no rule tying a slot to
  the registration end date, and registration can be extended past a slot's date.
* **Exam status.** `draft -> registration_open <-> registration_closed -> scheduled -> completed`
  (and `registration_open -> draft` while nobody has registered). Opening needs at least one slot and an end date
  in the future. Completing needs every slot to have finished. Scheduled/completed exams are read-only.
* **Deleting.** A center with slots is deactivated, not deleted. A slot with candidates, or the last slot of an
  open exam, cannot be deleted. Capacity cannot drop below the seats already booked.
* **Times** are business time (`DB_TIME_ZONE`, default +05:30): `YYYY-MM-DD`, `HH:MM[:SS]`, `YYYY-MM-DD HH:MM:SS`.
  "Now" always comes from MySQL's clock.
* **Security.** Every route sits behind `authenticate` + `authorizeRoles('ADMIN')`; students, invigilators and
  teachers get 403, no token gets 401. Unknown JSON fields are rejected (no mass-assignment, e.g. `status` can only
  change through the status endpoint). Writes are rate-limited per admin. Locks are always taken exam -> center -> slot.

## Endpoints (all ADMIN only, under `/api/admin`)

| Method + URL | Body | Purpose |
|---|---|---|
| POST `/examinations` | `exam_name`, `registration_start_date`, `registration_end_date`, `exam_duration_minutes`; optional `description`, `instructions`, `fee` | create (status `draft`) |
| GET `/examinations?page&limit&status&q` | | list with slot/registration counts |
| GET `/examinations/:id` | | one exam + slot summary |
| PATCH `/examinations/:id` | any of the create fields | edit |
| PATCH `/examinations/:id/status` | `{status}` | publish / close / reopen / schedule / complete |
| POST `/examinations/:id/slots` | `center_id`, `exam_date`, `slot_start_time`, `slot_end_time`, `capacity` | create a slot |
| GET `/examinations/:id/slots?center_id&date` | | list slots with `booked_count`, `seats_left` |
| PATCH `/slots/:id` | `{capacity}` | change capacity |
| DELETE `/slots/:id` | | delete an unused slot |
| POST `/centers` | `center_name`, `city`, `state`; optional `address` | create |
| GET `/centers?page&limit&city&state&is_active&q` | | list with PC counts |
| GET `/centers/:id` | | one center + upcoming slot count |
| PATCH `/centers/:id` | `center_name`, `address`, `city`, `state`, `is_active` | edit / deactivate |
| DELETE `/centers/:id` | | delete a center with no slots |
| POST `/centers/:id/computers` | `count`; optional `prefix`, `start_number` | bulk-create PCs |
| GET `/centers/:id/computers?status&page&limit` | | list PCs |
| PATCH `/centers/:id/computers/:pcId` | `{status: available \| maintenance}` | service status |
| DELETE `/centers/:id/computers/:pcId` | | delete an unused PC |

Responses are `{ success, message, data }`. Errors are `{ success: false, message }`; validation errors add
`errors: [{ field, message }]` (422); rule conflicts add a machine-readable `code` (and sometimes `details`) (409/422),
for example `CAPACITY_EXCEEDED`, `SLOT_EXISTS`, `SLOT_IN_USE`, `NO_SLOTS`, `INVALID_TRANSITION`, `PC_LABEL_EXISTS`.

## Manual testing

* PowerShell: `powershell -ExecutionPolicy Bypass -File .\scripts\phase3b-smoke.ps1 -AdminEmail you@example.com`
  (asks for the password; ~45 checks against the running server; creates objects named "SMOKE ...").
* Postman: import `scripts/ExamPro-Phase3B.postman_collection.json`, set `adminEmail` / `adminPassword`, run folder 0 then 1-4.

## Known limitations

* Rate-limit counters are in memory (per server process).
* Examinations cannot be deleted yet (no endpoint); a draft can simply be left unused.
* Student-facing endpoints (browse exams, centers, slots, register) are Phase 3C.
* MySQL older than 8.0.16 ignores CHECK constraints; the services validate the same rules either way.
