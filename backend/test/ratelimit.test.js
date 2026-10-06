// Rate limiting (runs in its own process so the limiter counters start clean).
const h = require('./support/harness');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Rate limiting', () => {
  before(async () => {
    h.resetDb();
    h.config.rateLimitDisabled = false; // the harness switches limits off; this file wants them ON
    await h.start();
  });
  after(() => h.stop());

  it('login: the 6th failed attempt for one email is answered with 429', async () => {
    const attempt = () => h.request('POST', '/api/auth/login', { body: { email: 'victim@example.com', password: 'Wrong-pass1' } });
    for (let i = 0; i < 5; i += 1) assert.equal((await attempt()).status, 401);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.success, false);
  });

  it('send-otp: the 6th request for one email within the hour is answered with 429', async () => {
    const send = () => h.request('POST', '/api/auth/send-otp', { body: { email: 'spam@example.com' } });
    for (let i = 0; i < 5; i += 1) assert.equal((await send()).status, 200);
    assert.equal((await send()).status, 429);
  });

  it('verify-otp: the 11th attempt for one email is answered with 429', async () => {
    const verify = () => h.request('POST', '/api/auth/verify-otp', { body: { email: 'guess@example.com', otp: '123456' } });
    for (let i = 0; i < 10; i += 1) assert.equal((await verify()).status, 400);
    assert.equal((await verify()).status, 429);
  });
});
