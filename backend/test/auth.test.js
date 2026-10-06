// Phase 2 authentication, tested over real HTTP against the real app (database + e-mail faked; see support/harness.js).
const h = require('./support/harness'); // must be first: sets NODE_ENV=test and test secrets
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const STUDENT = { full_name: 'Asha Rao', email: 'asha@example.com', mobile_number: '9876543210', password: 'Passw0rd1' };
const register = (over = {}) => h.request('POST', '/api/auth/register', { body: { ...STUDENT, ...over } });
const lastOtp = () => h.outbox[h.outbox.length - 1].otp;

describe('Phase 2 authentication', () => {
  before(() => h.start());
  after(() => h.stop());
  beforeEach(() => h.resetDb());

  it('GET /api/health still returns 200', async () => {
    const r = await h.request('GET', '/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { status: 'ok', message: 'ExamPro backend is running.' });
  });

  it('unknown routes and malformed JSON use the standard error shape', async () => {
    const nf = await h.request('GET', '/api/nope');
    assert.equal(nf.status, 404);
    assert.deepEqual(nf.json, { success: false, message: 'Route not found.' });
    const bad = await h.request('POST', '/api/auth/login', { rawBody: '{ not json' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.success, false);
  });

  describe('registration', () => {
    it('registers a student (201), sends one 6-digit OTP, and never leaks secrets', async () => {
      const r = await register();
      assert.equal(r.status, 201);
      assert.equal(r.json.success, true);
      assert.equal(h.outbox.length, 1);
      assert.match(h.outbox[0].otp, /^\d{6}$/);
      assert.equal(h.outbox[0].to, STUDENT.email);
      assert.ok(!r.text.includes(h.outbox[0].otp), 'OTP must not be in the API response');
      assert.ok(!/password|hash/i.test(r.text), 'no password/hash in the response');
    });

    it('stores the password and the OTP hashed, never in plain text', async () => {
      await register();
      assert.notEqual(h.db.students[0].password_hash, STUDENT.password);
      assert.match(h.db.students[0].password_hash, /^\$2[aby]\$/); // bcrypt
      assert.notEqual(h.db.otps[0].hash, lastOtp());
      assert.match(h.db.otps[0].hash, /^[0-9a-f]{64}$/); // HMAC-SHA256 hex
    });

    it('rejects invalid input with 422', async () => {
      for (const over of [
        { email: 'not-an-email' },
        { password: 'short1' },
        { password: 'onlyletters' },
        { password: '12345678' },
        { full_name: 'A' },
        { mobile_number: '123' },
        { date_of_birth: '31-12-2000' },
        { date_of_birth: '2999-01-01' },
      ]) {
        const r = await register(over);
        assert.equal(r.status, 422, `expected 422 for ${JSON.stringify(over)}`);
        assert.equal(r.json.success, false);
      }
      assert.equal(h.db.students.length, 0);
    });

    it('rejects a missing field and unexpected fields', async () => {
      const { password, ...noPassword } = STUDENT;
      assert.equal((await h.request('POST', '/api/auth/register', { body: noPassword })).status, 422);
      assert.equal((await register({ role: 'ADMIN' })).status, 422); // a client can never choose a role
      assert.equal((await h.request('POST', '/api/auth/register', { body: [] })).status, 400);
    });

    it('accepts personal (non-college) email addresses', async () => {
      assert.equal((await register({ email: 'someone@gmail.com' })).status, 201);
    });

    it('returns 409 for an email that is already registered and verified', async () => {
      await h.seedStudent({ email: STUDENT.email, password: 'Passw0rd1' });
      const r = await register();
      assert.equal(r.status, 409);
    });
  });

  describe('OTP verification', () => {
    it('verifies with the correct OTP, then the same OTP cannot be used again', async () => {
      await register();
      const otp = lastOtp();
      const ok = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp } });
      assert.equal(ok.status, 200);
      assert.equal(h.db.students[0].email_verified, 1);
      const again = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp } });
      assert.equal(again.status, 409);
    });

    it('rejects a wrong OTP (400) and a malformed OTP (422)', async () => {
      await register();
      const wrong = lastOtp() === '000000' ? '111111' : '000000';
      assert.equal((await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp: wrong } })).status, 400);
      assert.equal((await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp: '12ab56' } })).status, 422);
      assert.equal(h.db.students[0].email_verified, 0);
    });

    it('rejects an expired OTP', async () => {
      await register();
      const otp = lastOtp();
      h.advance(11 * 60); // OTP lives 10 minutes
      const r = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp } });
      assert.equal(r.status, 400);
    });

    it('locks the OTP after too many wrong attempts, even for the right code', async () => {
      await register();
      const otp = lastOtp();
      const wrong = otp === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i += 1) {
        assert.equal((await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp: wrong } })).status, 400);
      }
      const r = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp } });
      assert.equal(r.status, 429);
      assert.equal(h.db.students[0].email_verified, 0);
    });

    it('enforces the resend cooldown, then a new OTP replaces the old one', async () => {
      await register();
      const first = lastOtp();
      const tooSoon = await h.request('POST', '/api/auth/send-otp', { body: { email: STUDENT.email } });
      assert.equal(tooSoon.status, 429);

      h.advance(61);
      const resend = await h.request('POST', '/api/auth/send-otp', { body: { email: STUDENT.email } });
      assert.equal(resend.status, 200);
      assert.equal(h.outbox.length, 2);
      const second = lastOtp();

      if (first !== second) {
        const old = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp: first } });
        assert.equal(old.status, 400, 'the previous OTP must stop working');
      }
      const ok = await h.request('POST', '/api/auth/verify-otp', { body: { email: STUDENT.email, otp: second } });
      assert.equal(ok.status, 200);
    });

    it('send-otp gives the same answer for an unknown email (no account discovery)', async () => {
      const r = await h.request('POST', '/api/auth/send-otp', { body: { email: 'nobody@example.com' } });
      assert.equal(r.status, 200);
      assert.equal(h.outbox.length, 0);
    });
  });

  describe('login', () => {
    it('blocks login until the email is verified (403)', async () => {
      await register();
      const r = await h.request('POST', '/api/auth/login', { body: { email: STUDENT.email, password: STUDENT.password } });
      assert.equal(r.status, 403);
      assert.equal(r.json.code, 'EMAIL_NOT_VERIFIED');
    });

    it('logs a verified student in: token, safe user data, secure refresh cookie', async () => {
      await h.seedStudent({ email: STUDENT.email, password: STUDENT.password });
      const r = await h.request('POST', '/api/auth/login', { body: { email: STUDENT.email, password: STUDENT.password } });
      assert.equal(r.status, 200);
      assert.equal(r.json.data.user.role, 'STUDENT');
      assert.equal(r.json.data.user.email, STUDENT.email);
      assert.ok(r.json.data.accessToken.split('.').length === 3, 'access token is a JWT');
      assert.deepEqual(Object.keys(r.json.data.user).sort(), ['email', 'email_verified', 'full_name', 'id', 'role'], 'only safe user fields');
      assert.deepEqual(Object.keys(r.json.data).sort(), ['accessToken', 'expiresIn', 'tokenType', 'user'], 'no refresh token in the body');

      const cookie = r.setCookie.find((c) => c.startsWith(`${h.REFRESH_COOKIE}=`));
      assert.ok(cookie, 'refresh cookie is set');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Path=\/api\/auth/i);
    });

    it('returns the same 401 for a wrong password and for an unknown email', async () => {
      await h.seedStudent({ email: STUDENT.email, password: STUDENT.password });
      const wrong = await h.request('POST', '/api/auth/login', { body: { email: STUDENT.email, password: 'Wrong-pass1' } });
      const unknown = await h.request('POST', '/api/auth/login', { body: { email: 'ghost@example.com', password: 'Wrong-pass1' } });
      assert.equal(wrong.status, 401);
      assert.equal(unknown.status, 401);
      assert.equal(wrong.json.message, unknown.json.message);
    });

    it('validates login input', async () => {
      assert.equal((await h.request('POST', '/api/auth/login', { body: { email: 'bad', password: 'x' } })).status, 422);
      assert.equal((await h.request('POST', '/api/auth/login', { body: { email: STUDENT.email } })).status, 422);
      assert.equal((await h.request('POST', '/api/auth/login', { body: { email: STUDENT.email, password: 'x', admin: true } })).status, 422);
    });

    it('does not let a staff account log in through the student path, or vice versa', async () => {
      await h.seedStaff({ email: 'boss@example.com', password: 'Admin1234', role: 'admin' });
      await h.seedStudent({ email: 'kid@example.com', password: 'Passw0rd1' });
      assert.equal((await h.request('POST', '/api/auth/login', { body: { email: 'boss@example.com', password: 'Admin1234', account_type: 'student' } })).status, 401);
      assert.equal((await h.request('POST', '/api/auth/login', { body: { email: 'kid@example.com', password: 'Passw0rd1', account_type: 'staff' } })).status, 401);
    });

    it('blocks a disabled staff account (403)', async () => {
      await h.seedStaff({ email: 'gone@example.com', password: 'Admin1234', role: 'invigilator' });
      h.db.users[0].is_active = 0;
      const r = await h.request('POST', '/api/auth/login', { body: { email: 'gone@example.com', password: 'Admin1234' } });
      assert.equal(r.status, 403);
    });
  });

  describe('access tokens', () => {
    beforeEach(() => h.seedStudent({ email: STUDENT.email, password: STUDENT.password }));

    it('GET /api/auth/me works with a valid token', async () => {
      const { token } = await h.loginAs(STUDENT.email, STUDENT.password);
      const r = await h.request('GET', '/api/auth/me', { token });
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data.user, { id: 1, role: 'STUDENT', email: STUDENT.email });
    });

    it('rejects a missing token (401)', async () => {
      assert.equal((await h.request('GET', '/api/auth/me')).status, 401);
      assert.equal((await h.request('GET', '/api/auth/me', { headers: { Authorization: 'Basic abc' } })).status, 401);
    });

    it('rejects garbage, wrongly-signed and wrong-audience tokens (401)', async () => {
      assert.equal((await h.request('GET', '/api/auth/me', { token: 'not.a.jwt' })).status, 401);
      const forged = h.signToken({ typ: 'access', st: 'student' }, { secret: 'some-other-secret', options: { subject: '1', expiresIn: '15m' } });
      assert.equal((await h.request('GET', '/api/auth/me', { token: forged })).status, 401);
      const wrongAud = h.signToken({ typ: 'access', st: 'student' }, { options: { subject: '1', expiresIn: '15m', audience: 'exam-portal-other' } });
      assert.equal((await h.request('GET', '/api/auth/me', { token: wrongAud })).status, 401);
      const wrongType = h.signToken({ typ: 'exam', st: 'student' }, { options: { subject: '1', expiresIn: '15m' } });
      assert.equal((await h.request('GET', '/api/auth/me', { token: wrongType })).status, 401);
    });

    it('rejects an expired token with code TOKEN_EXPIRED (401)', async () => {
      const exp = Math.floor(Date.now() / 1000) - 60;
      const expired = h.signToken({ typ: 'access', st: 'student', exp }, { options: { subject: '1' } });
      const r = await h.request('GET', '/api/auth/me', { token: expired });
      assert.equal(r.status, 401);
      assert.equal(r.json.code, 'TOKEN_EXPIRED');
    });
  });

  describe('refresh and logout', () => {
    beforeEach(() => h.seedStudent({ email: STUDENT.email, password: STUDENT.password }));

    it('refresh rotates the token and returns a new access token', async () => {
      const { refreshCookie } = await h.loginAs(STUDENT.email, STUDENT.password);
      const r = await h.request('POST', '/api/auth/refresh', { cookie: refreshCookie });
      assert.equal(r.status, 200);
      assert.ok(r.json.data.accessToken);
      const next = h.refreshCookieOf(r);
      assert.ok(next && next !== refreshCookie, 'a new refresh token is issued');
      assert.ok((await h.request('GET', '/api/auth/me', { token: r.json.data.accessToken })).status === 200);
    });

    it('refresh without a cookie is rejected', async () => {
      const r = await h.request('POST', '/api/auth/refresh');
      assert.equal(r.status, 401);
      assert.equal(r.json.message, 'Session expired. Please log in again.');
    });

    it('re-using an old refresh token fails and revokes the whole session family', async () => {
      const { refreshCookie } = await h.loginAs(STUDENT.email, STUDENT.password);
      const first = await h.request('POST', '/api/auth/refresh', { cookie: refreshCookie });
      const newer = h.refreshCookieOf(first);
      assert.equal((await h.request('POST', '/api/auth/refresh', { cookie: refreshCookie })).status, 401); // replay
      assert.equal((await h.request('POST', '/api/auth/refresh', { cookie: newer })).status, 401); // family revoked
    });

    it('logout revokes the refresh token', async () => {
      const { refreshCookie } = await h.loginAs(STUDENT.email, STUDENT.password);
      const out = await h.request('POST', '/api/auth/logout', { cookie: refreshCookie });
      assert.equal(out.status, 200);
      const after = await h.request('POST', '/api/auth/refresh', { cookie: refreshCookie });
      assert.equal(after.status, 401);
      assert.equal(after.json.message, 'Session expired. Please log in again.');
    });

    it('logout without a cookie still succeeds', async () => {
      assert.equal((await h.request('POST', '/api/auth/logout')).status, 200);
    });
  });
});
