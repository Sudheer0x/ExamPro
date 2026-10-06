// Role-based access control, tested over real HTTP (database faked; see support/harness.js).
const h = require('./support/harness');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

describe('Role-based access control', () => {
  let admin, invigilator, teacher, student;

  before(async () => {
    await h.start();
    h.resetDb();
    await h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin', fullName: 'The Admin' });
    await h.seedStaff({ email: 'inv@example.com', password: 'Invig1234', role: 'invigilator', fullName: 'The Invigilator' });
    await h.seedStaff({ email: 'teach@example.com', password: 'Teach1234', role: 'teacher', fullName: 'The Teacher' });
    await h.seedStudent({ email: 'stu@example.com', password: 'Stud1234x', fullName: 'The Student', mobile: '9000000001' });
    await h.seedStudent({ email: 'other@example.com', password: 'Stud1234x', fullName: 'Another Student', mobile: '9000000002' });
    admin = (await h.loginAs('admin@example.com', 'Admin1234')).token;
    invigilator = (await h.loginAs('inv@example.com', 'Invig1234')).token;
    teacher = (await h.loginAs('teach@example.com', 'Teach1234')).token;
    student = (await h.loginAs('stu@example.com', 'Stud1234x')).token;
  });
  after(() => h.stop());

  const status = async (url, token) => (await h.request('GET', url, { token })).status;

  it('every protected route returns 401 without a token', async () => {
    for (const url of ['/api/student/profile', '/api/admin/users', '/api/admin/users/1', '/api/invigilator/profile', '/api/auth/me']) {
      assert.equal(await status(url), 401, url);
    }
  });

  it('STUDENT: own profile works; admin and invigilator areas are 403', async () => {
    assert.equal(await status('/api/student/profile', student), 200);
    assert.equal(await status('/api/admin/users', student), 403);
    assert.equal(await status('/api/admin/users/1', student), 403);
    assert.equal(await status('/api/invigilator/profile', student), 403);
  });

  it('STUDENT profile is the caller\'s own, with safe fields only', async () => {
    const r = await h.request('GET', '/api/student/profile', { token: student });
    assert.equal(r.json.data.full_name, 'The Student');
    assert.equal(r.json.data.email, 'stu@example.com');
    assert.equal(r.json.data.phone, '9000000001');
    assert.equal(r.json.data.email_verified, true);
    assert.equal(r.json.data.account_status, 'ACTIVE');
    assert.ok(!/password|hash|otp/i.test(r.text), 'no secrets in the profile');
    const other = await h.request('GET', '/api/student/profile', { token: (await h.loginAs('other@example.com', 'Stud1234x')).token });
    assert.equal(other.json.data.full_name, 'Another Student', 'each student sees only their own record');
  });

  it('ADMIN: admin endpoints work; student and invigilator areas are 403', async () => {
    assert.equal(await status('/api/admin/users', admin), 200);
    assert.equal(await status('/api/admin/users/1', admin), 200);
    assert.equal(await status('/api/student/profile', admin), 403);
    assert.equal(await status('/api/invigilator/profile', admin), 403);
  });

  it('ADMIN user list is paginated, validated, and never contains password hashes', async () => {
    const r = await h.request('GET', '/api/admin/users', { token: admin });
    assert.equal(r.json.data.total, 3);
    assert.equal(r.json.data.users.length, 3);
    assert.ok(!/password|hash/i.test(r.text));
    const paged = await h.request('GET', '/api/admin/users?limit=1&page=2', { token: admin });
    assert.equal(paged.json.data.users.length, 1);
    const onlyInv = await h.request('GET', '/api/admin/users?role=invigilator', { token: admin });
    assert.equal(onlyInv.json.data.total, 1);
    assert.equal((await h.request('GET', '/api/admin/users?limit=1000', { token: admin })).status, 422);
    assert.equal((await h.request('GET', '/api/admin/users?role=hacker', { token: admin })).status, 422);
    assert.equal((await h.request('GET', '/api/admin/users/abc', { token: admin })).status, 422);
    assert.equal((await h.request('GET', '/api/admin/users/9999', { token: admin })).status, 404);
  });

  it('INVIGILATOR: own endpoint works; admin and student areas are 403', async () => {
    const r = await h.request('GET', '/api/invigilator/profile', { token: invigilator });
    assert.equal(r.status, 200);
    assert.equal(r.json.data.role, 'INVIGILATOR');
    assert.equal(r.json.data.email, 'inv@example.com');
    assert.equal(await status('/api/admin/users', invigilator), 403);
    assert.equal(await status('/api/student/profile', invigilator), 403);
  });

  it('TEACHER (examiner) is kept out of admin, student and invigilator areas', async () => {
    assert.equal(await status('/api/admin/users', teacher), 403);
    assert.equal(await status('/api/student/profile', teacher), 403);
    assert.equal(await status('/api/invigilator/profile', teacher), 403);
    assert.equal(await status('/api/auth/me', teacher), 200);
  });

  it('the role comes from the database, not from the token', async () => {
    const adminRow = h.db.users.find((u) => u.email === 'admin@example.com');
    assert.equal(await status('/api/admin/users', admin), 200);
    adminRow.role = 'invigilator'; // demoted after the token was issued
    assert.equal(await status('/api/admin/users', admin), 403);
    assert.equal(await status('/api/invigilator/profile', admin), 200);
    adminRow.role = 'admin';
    assert.equal(await status('/api/admin/users', admin), 200);
  });

  it('a disabled staff account is locked out immediately, even with a valid token', async () => {
    const row = h.db.users.find((u) => u.email === 'inv@example.com');
    row.is_active = 0;
    assert.equal(await status('/api/invigilator/profile', invigilator), 401);
    row.is_active = 1;
  });
});
