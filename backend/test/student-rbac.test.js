// RBAC matrix for every Phase 3C endpoint, over real HTTP (database faked; see support/harness.js).
// All six endpoints are STUDENT-only.
const h = require('./support/harness');
const { buildScenario } = require('./support/scenario');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ENDPOINTS = [
  ['GET', '/api/exam'],
  ['GET', '/api/exam/1'],
  ['GET', '/api/exam/1/slots'],
  ['GET', '/api/registration/mine'],
  ['POST', '/api/registration'],
  ['DELETE', '/api/registration/1'],
];

describe('Phase 3C RBAC', () => {
  let tokens;

  before(async () => {
    await h.start();
    ({ tokens } = await buildScenario(h));
  });
  after(() => h.stop());

  const call = (method, url, token) => h.request(method, url, { token, body: method === 'POST' ? { slot_id: 1 } : undefined });

  it('covers all 6 endpoints', () => assert.equal(ENDPOINTS.length, 6));

  for (const [method, url] of ENDPOINTS) {
    it(`${method} ${url}: 401 without a token`, async () => {
      assert.equal((await call(method, url)).status, 401);
    });

    it(`${method} ${url}: 401 with an invalid token`, async () => {
      assert.equal((await call(method, url, 'not.a.valid.token')).status, 401);
    });

    for (const role of ['admin', 'invigilator', 'teacher']) {
      it(`${method} ${url}: 403 for ${role}`, async () => {
        const r = await call(method, url, tokens[role]);
        assert.equal(r.status, 403);
        assert.equal(r.json.success, false);
      });
    }

    it(`${method} ${url}: a student gets past the guard`, async () => {
      const r = await call(method, url, tokens.student1);
      assert.ok(r.status !== 401 && r.status !== 403, `student was refused with ${r.status}`);
    });
  }
});
