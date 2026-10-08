// Rate limiting for student registration (runs in its own process so the limiter counters start clean).
const h = require('./support/harness');
const { buildScenario } = require('./support/scenario');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Registration rate limiting', () => {
  let token;

  before(async () => {
    await h.start();
    ({ tokens: { student1: token } } = await buildScenario(h));
    h.config.rateLimitDisabled = false; // the harness switches limits off; this file wants them ON
  });
  after(() => h.stop());

  it('POST /api/registration: the 11th attempt in ten minutes is answered with 429', async () => {
    const attempt = () => h.request('POST', '/api/registration', { token, body: { slot_id: 99999 } });
    for (let i = 0; i < 10; i += 1) assert.equal((await attempt()).status, 404);
    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.equal(blocked.json.success, false);
  });

  it('DELETE /api/registration/:id: the 21st attempt is answered with 429 (separate counter)', async () => {
    const attempt = () => h.request('DELETE', '/api/registration/99999', { token });
    for (let i = 0; i < 20; i += 1) assert.equal((await attempt()).status, 404);
    assert.equal((await attempt()).status, 429);
  });
});
