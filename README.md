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
