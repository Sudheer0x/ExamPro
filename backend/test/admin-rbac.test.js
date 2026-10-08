// RBAC matrix for every Phase 3B endpoint, over real HTTP (database faked; see support/harness.js).
// Anyone who is not an admin must be refused BEFORE any validation or database work happens.
const h = require('./support/harness');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

const ENDPOINTS = [
  ['POST', '/api/admin/examinations'],
  ['GET', '/api/admin/examinations'],
  ['GET', '/api/admin/examinations/1'],
  ['PATCH', '/api/admin/examinations/1'],
  ['PATCH', '/api/admin/examinations/1/status'],
  ['POST', '/api/admin/examinations/1/slots'],
  ['GET', '/api/admin/examinations/1/slots'],
  ['POST', '/api/admin/centers'],
  ['GET', '/api/admin/centers'],
  ['GET', '/api/admin/centers/1'],
  ['PATCH', '/api/admin/centers/1'],
  ['DELETE', '/api/admin/centers/1'],
  ['POST', '/api/admin/centers/1/computers'],
  ['GET', '/api/admin/centers/1/computers'],
  ['PATCH', '/api/admin/centers/1/computers/1'],
  ['DELETE', '/api/admin/centers/1/computers/1'],
  ['PATCH', '/api/admin/slots/1'],
  ['DELETE', '/api/admin/slots/1'],
];

describe('Phase 3B RBAC', () => {
  const tokens = {};

  before(async () => {
    await h.start();
    h.resetDb();
    await h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' });
    await h.seedStaff({ email: 'inv@example.com', password: 'Invig1234', role: 'invigilator' });
    await h.seedStaff({ email: 'teach@example.com', password: 'Teach1234', role: 'teacher' });
    await h.seedStudent({ email: 'stu@example.com', password: 'Stud1234x' });
    tokens.admin = (await h.loginAs('admin@example.com', 'Admin1234')).token;
    tokens.invigilator = (await h.loginAs('inv@example.com', 'Invig1234')).token;
    tokens.teacher = (await h.loginAs('teach@example.com', 'Teach1234')).token;
    tokens.student = (await h.loginAs('stu@example.com', 'Stud1234x')).token;
  });
  after(() => h.stop());

  const call = (method, url, token) => h.request(method, url, { token, body: method === 'GET' || method === 'DELETE' ? undefined : {} });

  it('covers all 18 endpoints', () => assert.equal(ENDPOINTS.length, 18));

  for (const [method, url] of ENDPOINTS) {
    it(`${method} ${url}: 401 without a token`, async () => {
      assert.equal((await call(method, url)).status, 401);
    });

    for (const role of ['student', 'invigilator', 'teacher']) {
      it(`${method} ${url}: 403 for ${role}`, async () => {
        const r = await call(method, url, tokens[role]);
        assert.equal(r.status, 403);
        assert.equal(r.json.success, false);
      });
    }

    it(`${method} ${url}: an admin gets past the guard`, async () => {
      const r = await call(method, url, tokens.admin);
      assert.ok(r.status !== 401 && r.status !== 403, `admin was refused with ${r.status}`);
    });
  }
});
