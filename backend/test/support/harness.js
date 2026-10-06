// test/support/harness.js
//
// Test harness for the HTTP-level tests (auth / RBAC / rate limiting).
//
//  * Runs the REAL Express app, real routes, real middleware, real services, real bcrypt and real JWT,
//    and talks to it over a real local HTTP port with fetch.
//  * The four database models and the e-mail sender are replaced by in-memory fakes, so these tests
//    NEVER touch MySQL (or your real data) and never send e-mail.
//  * That means the SQL inside src/models/* is NOT exercised here — the live checks (npm run migrate,
//    a real login against your database) cover that. A "drift guard" below fails loudly if a model gains
//    or loses a function that the fake does not mirror.
//
// IMPORTANT: this file must be required BEFORE anything from ../../src, because it sets NODE_ENV=test
// and the test secrets first.

'use strict';

process.env.NODE_ENV = 'test';
Object.assign(process.env, {
  JWT_SECRET: 'test-jwt-secret-used-only-by-automated-tests-0123456789',
  JWT_ACCESS_EXPIRES_IN: '15m',
  REFRESH_TOKEN_DAYS: '7',
  OTP_LENGTH: '6',
  OTP_EXPIRY_MINUTES: '10',
  OTP_MAX_ATTEMPTS: '5',
  OTP_RESEND_COOLDOWN_SECONDS: '60',
  OTP_HMAC_SECRET: 'test-otp-hmac-secret',
  RATE_LIMIT_DISABLED: 'true',
  TRUST_PROXY: '',
  SMTP_HOST: '',
  SMTP_USER: '',
  SMTP_PASSWORD: '',
});

const assert = require('node:assert/strict');
const path = require('path');

const src = (...p) => path.join(__dirname, '..', '..', 'src', ...p);

// ---------- in-memory "database" + fake clock (seconds) ----------
const db = { students: [], users: [], otps: [], refreshTokens: [] };
const clock = { t: 0 };
const outbox = []; // captured OTP e-mails: { to, otp }
let ids = { student: 0, user: 0, otp: 0, rt: 0 };

function resetDb() {
  db.students.length = 0;
  db.users.length = 0;
  db.otps.length = 0;
  db.refreshTokens.length = 0;
  outbox.length = 0;
  clock.t = 0;
  ids = { student: 0, user: 0, otp: 0, rt: 0 };
}
const advance = (seconds) => { clock.t += seconds; };

// ---------- fakes mirroring src/models/* ----------
const SAFE_USER_COLUMNS = ['id', 'full_name', 'email', 'role', 'is_active', 'created_at', 'updated_at'];
const pick = (obj, keys) => Object.fromEntries(keys.map((k) => [k, obj[k]]));

const fakeUserModel = {
  async findByEmailWithHash(email) {
    const u = db.users.find((x) => x.email === email);
    return u ? pick(u, ['id', 'full_name', 'email', 'password_hash', 'role', 'is_active']) : null;
  },
  async findAuthById(id) {
    const u = db.users.find((x) => x.id === id);
    return u ? pick(u, ['id', 'email', 'role', 'is_active']) : null;
  },
  async findPublicById(id) {
    const u = db.users.find((x) => x.id === id);
    return u ? pick(u, SAFE_USER_COLUMNS) : null;
  },
  async list({ limit, offset, role }) {
    const all = db.users.filter((u) => !role || u.role === role);
    return { rows: all.slice(offset, offset + limit).map((u) => pick(u, SAFE_USER_COLUMNS)), total: all.length };
  },
  async create({ full_name, email, password_hash, role }) {
    const id = ++ids.user;
    db.users.push({ id, full_name, email, password_hash, role, is_active: 1, created_at: '2026-01-01 00:00:00', updated_at: '2026-01-01 00:00:00' });
    return id;
  },
};

const fakeStudentModel = {
  async findByEmailWithHash(email) {
    const s = db.students.find((x) => x.email === email);
    return s ? pick(s, ['id', 'full_name', 'email', 'mobile_number', 'email_verified', 'password_hash']) : null;
  },
  async findAuthById(id) {
    const s = db.students.find((x) => x.id === id);
    return s ? pick(s, ['id', 'email', 'email_verified']) : null;
  },
  async findProfileById(id) {
    const s = db.students.find((x) => x.id === id);
    return s ? pick(s, ['id', 'full_name', 'email', 'mobile_number', 'email_verified', 'created_at']) : null;
  },
  async createPending({ full_name, email, mobile_number, date_of_birth, password_hash }) {
    const id = ++ids.student;
    db.students.push({ id, full_name, email, mobile_number, date_of_birth: date_of_birth || null, password_hash, email_verified: 0, created_at: '2026-01-01 00:00:00' });
    return id;
  },
  async updatePending(id, { full_name, mobile_number, date_of_birth, password_hash }) {
    const s = db.students.find((x) => x.id === id && !x.email_verified);
    if (s) Object.assign(s, { full_name, mobile_number, date_of_birth: date_of_birth || null, password_hash });
  },
  async markEmailVerified(id) {
    const s = db.students.find((x) => x.id === id);
    if (s) s.email_verified = 1;
  },
};

const fakeOtpModel = {
  async secondsSinceLastOtp(email, purpose) {
    const last = db.otps.filter((o) => o.email === email && o.purpose === purpose).pop();
    return last ? clock.t - last.createdAt : null;
  },
  async expireOpenOtps(email, purpose) {
    db.otps.forEach((o) => {
      if (o.email === email && o.purpose === purpose && !o.verified && o.expiresAt > clock.t) o.expiresAt = clock.t;
    });
  },
  async insert({ email, purpose, otpHash, expiryMinutes }) {
    const id = ++ids.otp;
    db.otps.push({ id, email, purpose, hash: otpHash, attempts: 0, verified: 0, createdAt: clock.t, expiresAt: clock.t + expiryMinutes * 60 });
    return id;
  },
  async removeById(id) {
    const i = db.otps.findIndex((o) => o.id === id);
    if (i !== -1) db.otps.splice(i, 1);
  },
  async findLatestOpen(email, purpose) {
    const o = db.otps.filter((x) => x.email === email && x.purpose === purpose && !x.verified && x.expiresAt > clock.t).pop();
    return o ? { id: o.id, otp_code: o.hash, attempts: o.attempts } : null;
  },
  async registerAttempt(id, maxAttempts) {
    const o = db.otps.find((x) => x.id === id);
    if (o && o.attempts < maxAttempts && !o.verified && o.expiresAt > clock.t) { o.attempts += 1; return true; }
    return false;
  },
  async consume(id) {
    const o = db.otps.find((x) => x.id === id);
    if (o && !o.verified && o.expiresAt > clock.t) { o.verified = 1; return true; }
    return false;
  },
};

const fakeRefreshTokenModel = {
  async create({ ownerType, ownerId, tokenHash, days }) {
    db.refreshTokens.push({ id: ++ids.rt, ownerType, ownerId, tokenHash, expiresAt: clock.t + days * 86400, revoked: false });
  },
  async findByHash(tokenHash) {
    const r = db.refreshTokens.find((x) => x.tokenHash === tokenHash);
    if (!r) return null;
    return {
      id: r.id,
      user_id: r.ownerType === 'staff' ? r.ownerId : null,
      student_id: r.ownerType === 'student' ? r.ownerId : null,
      revoked_at: r.revoked ? '2026-01-01 00:00:00' : null,
      is_expired: r.expiresAt <= clock.t ? 1 : 0,
    };
  },
  async revokeIfActive(id) {
    const r = db.refreshTokens.find((x) => x.id === id);
    if (!r || r.revoked) return false;
    r.revoked = true;
    return true;
  },
  async revokeByHash(tokenHash) {
    db.refreshTokens.forEach((r) => { if (r.tokenHash === tokenHash) r.revoked = true; });
  },
  async revokeAllForOwner(ownerType, ownerId) {
    db.refreshTokens.forEach((r) => { if (r.ownerType === ownerType && r.ownerId === ownerId) r.revoked = true; });
  },
};

const fakeEmailService = {
  async sendOtpEmail(to, otp) { outbox.push({ to, otp }); },
};

// ---------- install the fakes (after a drift check against the real modules) ----------
function installFakes() {
  const models = {
    'models/userModel.js': fakeUserModel,
    'models/studentModel.js': fakeStudentModel,
    'models/otpModel.js': fakeOtpModel,
    'models/refreshTokenModel.js': fakeRefreshTokenModel,
  };

  // Drift guard: the fake must expose exactly the functions the real model exports.
  for (const [rel, fake] of Object.entries(models)) {
    const real = require(src(rel)); // loads the real model (the DB pool is lazy: nothing connects)
    assert.deepEqual(
      Object.keys(fake).sort(),
      Object.keys(real).sort(),
      `Test fake for ${rel} is out of sync with the real model — update test/support/harness.js`
    );
  }

  const put = (rel, exports) => {
    const file = require.resolve(src(rel));
    require.cache[file] = { id: file, filename: file, loaded: true, exports, children: [], paths: [] };
  };
  Object.entries(models).forEach(([rel, fake]) => put(rel, fake));
  put('services/emailService.js', fakeEmailService);
}
installFakes();

// ---------- the running app ----------
const config = require(src('config/env'));
const jwt = require('jsonwebtoken');
const { hashPassword } = require(src('utils/password'));
const REFRESH_COOKIE = config.refresh.cookieName;

let server;
let base;

async function start() {
  const app = require(src('app'));
  server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
}

async function stop() {
  if (!server) return;
  await new Promise((resolve) => {
    server.close(() => resolve());
    if (server.closeAllConnections) server.closeAllConnections();
  });
}

/** request('POST', '/api/auth/login', { body, token, cookie, rawBody }) -> { status, json, setCookie } */
async function request(method, url, { body, rawBody, token, cookie, headers = {} } = {}) {
  const h = { ...headers };
  let payload;
  if (rawBody !== undefined) { payload = rawBody; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  if (token) h.Authorization = `Bearer ${token}`;
  if (cookie) h.Cookie = `${REFRESH_COOKIE}=${cookie}`;

  const res = await fetch(base + url, { method, headers: h, body: payload });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* not JSON */ }
  return { status: res.status, json, text, setCookie: res.headers.getSetCookie ? res.headers.getSetCookie() : [] };
}

/** Value of the refresh cookie from a response's Set-Cookie headers (null if absent). */
function refreshCookieOf(res) {
  const line = res.setCookie.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  return line ? line.split(';')[0].slice(REFRESH_COOKIE.length + 1) : null;
}

// ---------- seeding helpers ----------
async function seedStaff({ email, password, role, fullName = 'Staff Member' }) {
  const id = await fakeUserModel.create({ full_name: fullName, email, password_hash: await hashPassword(password), role });
  return id;
}
async function seedStudent({ email, password, verified = true, fullName = 'Test Student', mobile = '9876543210' }) {
  const id = await fakeStudentModel.createPending({ full_name: fullName, email, mobile_number: mobile, date_of_birth: null, password_hash: await hashPassword(password) });
  if (verified) await fakeStudentModel.markEmailVerified(id);
  return id;
}

async function loginAs(email, password, account_type) {
  const body = { email, password };
  if (account_type) body.account_type = account_type;
  const res = await request('POST', '/api/auth/login', { body });
  assert.equal(res.status, 200, `login as ${email} failed: ${res.text}`);
  return { token: res.json.data.accessToken, refreshCookie: refreshCookieOf(res), res };
}

/** Sign an access token by hand (for expired / forged-token tests). */
function signToken(payload, { secret = config.jwt.secret, options = {} } = {}) {
  return jwt.sign(payload, secret, { algorithm: 'HS256', issuer: config.jwt.issuer, audience: config.jwt.audience, ...options });
}

module.exports = {
  config, db, outbox, advance, resetDb,
  start, stop, request, refreshCookieOf, REFRESH_COOKIE,
  seedStaff, seedStudent, loginAs, signToken,
};
