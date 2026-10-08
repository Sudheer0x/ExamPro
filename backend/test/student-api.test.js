// Phase 3C student API over real HTTP: routing, validation, controllers, envelopes and error codes.
// (Database faked; business rules are covered in depth by registration-services.test.js and,
// for concurrency, by the real-database tests.)
const h = require('./support/harness');
const { buildScenario } = require('./support/scenario');
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('Phase 3C student API', () => {
  let ctx;
  const as = (who) => (method, url, body) => h.request(method, url, { token: ctx.tokens[who], body });
  const s1 = (m, u, b) => as('student1')(m, u, b);
  const s2 = (m, u, b) => as('student2')(m, u, b);

  before(() => h.start());
  after(() => h.stop());
  beforeEach(async () => { ctx = await buildScenario(h, { capacity: 2 }); });

  describe('exam discovery', () => {
    it('GET /api/exam lists visible exams with a clean envelope and pagination info', async () => {
      const r = await s1('GET', '/api/exam');
      assert.equal(r.status, 200);
      assert.equal(r.json.success, true);
      assert.deepEqual([r.json.data.page, r.json.data.limit, r.json.data.total], [1, 20, 1]);
      const e = r.json.data.examinations[0];
      assert.deepEqual([e.exam_name, e.registration_state, e.can_register, e.fee], ['ExamPro CBT 2026', 'open', true, '0.00']);
      assert.ok(!('created_at' in e) && !('instructions' in e), 'list rows carry no internal or bulky fields');
    });

    it('hides drafts and supports search and pagination', async () => {
      await ctx.services.exams.create({ exam_name: 'Secret draft', registration_start_date: '2026-10-01 09:00:00', registration_end_date: '2026-10-31 23:59:59', exam_duration_minutes: 60, fee: '0.00' });
      assert.equal((await s1('GET', '/api/exam')).json.data.total, 1);
      assert.equal((await s1('GET', '/api/exam?q=cbt')).json.data.total, 1);
      assert.equal((await s1('GET', '/api/exam?q=secret')).json.data.total, 0);
      assert.equal((await s1('GET', '/api/exam?limit=1&page=2')).json.data.examinations.length, 0);
    });

    it('validates paging and search input (422)', async () => {
      for (const q of ['limit=0', 'limit=1000', 'page=0', 'page=abc', `q=${'x'.repeat(101)}`]) {
        assert.equal((await s1('GET', `/api/exam?${q}`)).status, 422, q);
      }
    });

    it('GET /api/exam/:id returns details with instructions and my_registration', async () => {
      const r = await s1('GET', `/api/exam/${ctx.exam.id}`);
      assert.equal(r.status, 200);
      assert.equal(r.json.data.examination.my_registration, null);
      assert.ok('instructions' in r.json.data.examination);
      await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      const after = await s1('GET', `/api/exam/${ctx.exam.id}`);
      assert.equal(after.json.data.examination.my_registration.status, 'completed');
    });

    it('returns 404 for unknown and non-visible exams, and 422 for invalid ids', async () => {
      const draft = await ctx.services.exams.create({ exam_name: 'Secret draft', registration_start_date: '2026-10-01 09:00:00', registration_end_date: '2026-10-31 23:59:59', exam_duration_minutes: 60, fee: '0.00' });
      assert.equal((await s1('GET', '/api/exam/99999')).status, 404);
      assert.equal((await s1('GET', `/api/exam/${draft.id}`)).status, 404);
      assert.equal((await s1('GET', `/api/exam/${draft.id}/slots`)).status, 404);
      for (const id of ['abc', '0', '-1', '1.5']) assert.equal((await s1('GET', `/api/exam/${id}`)).status, 422, id);
    });

    it('GET /api/exam/:id/slots lists slots with seats, and filters by center and date', async () => {
      const r = await s1('GET', `/api/exam/${ctx.exam.id}/slots`);
      assert.equal(r.status, 200);
      assert.deepEqual(r.json.data.examination.can_register, true);
      const [slot] = r.json.data.slots;
      assert.deepEqual([slot.id, slot.center_name, slot.city, slot.capacity, slot.booked_count, slot.seats_left, slot.is_full], [ctx.slot.id, 'ExamPro Centre - Vijayawada', 'Vijayawada', 2, 0, 2, false]);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots?center_id=${ctx.center.id}&date=2026-12-14`)).json.data.slots.length, 1);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots?center_id=99999`)).json.data.slots.length, 0);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots?date=2027-01-01`)).json.data.slots.length, 0);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots?date=14-12-2026`)).status, 422);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots?center_id=abc`)).status, 422);
    });

    it('seats left follow registrations and cancellations', async () => {
      const reg = (await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.data.registration;
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots`)).json.data.slots[0].seats_left, 1);
      await s1('DELETE', `/api/registration/${reg.id}`);
      assert.equal((await s1('GET', `/api/exam/${ctx.exam.id}/slots`)).json.data.slots[0].seats_left, 2);
    });
  });

  describe('registering', () => {
    it('POST /api/registration creates a registration (201)', async () => {
      const r = await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      assert.equal(r.status, 201);
      assert.equal(r.json.success, true);
      const reg = r.json.data.registration;
      assert.match(reg.registration_id, /^EXP2026\d{6}$/);
      assert.match(reg.application_id, /^APP2026\d{6}$/);
      assert.deepEqual([reg.status, reg.can_cancel, reg.examination.id, reg.center.id, reg.slot.id], ['completed', true, ctx.exam.id, ctx.center.id, ctx.slot.id]);
      assert.equal(h.db.registrations[0].student_id, ctx.studentIds.s1, 'the student comes from the login');
    });

    it('rejects a client-supplied student_id and any other extra field (422)', async () => {
      const r = await s1('POST', '/api/registration', { slot_id: ctx.slot.id, student_id: ctx.studentIds.s2 });
      assert.equal(r.status, 422);
      assert.match(r.json.message, /Unexpected field/);
      assert.equal((await s1('POST', '/api/registration', { slot_id: ctx.slot.id, examination_id: 1 })).status, 422);
      assert.equal(h.db.registrations.length, 0);
    });

    it('validates slot_id (422)', async () => {
      for (const body of [{}, { slot_id: '12' }, { slot_id: 1.5 }, { slot_id: 0 }, { slot_id: -3 }, { slot_id: null }, { slot_id: true }, { slot_id: [1] }]) {
        assert.equal((await s1('POST', '/api/registration', body)).status, 422, JSON.stringify(body));
      }
      assert.equal((await h.request('POST', '/api/registration', { token: ctx.tokens.student1, body: [] })).status, 400);
    });

    it('returns 404 SLOT_NOT_FOUND for an unknown slot', async () => {
      const r = await s1('POST', '/api/registration', { slot_id: 99999 });
      assert.equal(r.status, 404);
      assert.equal(r.json.code, 'SLOT_NOT_FOUND');
    });

    it('returns 409 DUPLICATE_REGISTRATION and 409 SLOT_FULL', async () => {
      assert.equal((await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).status, 201);
      const dup = await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      assert.equal(dup.status, 409);
      assert.equal(dup.json.code, 'DUPLICATE_REGISTRATION');
      assert.equal(dup.json.success, false);

      assert.equal((await s2('POST', '/api/registration', { slot_id: ctx.slot.id })).status, 201);
      const third = await h.request('POST', '/api/registration', { token: (await registerExtraStudent()).token, body: { slot_id: ctx.slot.id } });
      assert.equal(third.status, 409);
      assert.equal(third.json.code, 'SLOT_FULL');
    });

    it('returns the registration-window error codes', async () => {
      h.db.examinations[0].registration_end_date = '2026-10-06 10:00:00';
      assert.equal((await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.code, 'REGISTRATION_CLOSED');
      h.db.examinations[0].registration_end_date = '2026-10-31 23:59:59';
      h.db.examinations[0].registration_start_date = '2026-10-20 00:00:00';
      assert.equal((await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.code, 'REGISTRATION_NOT_STARTED');
    });

    it('returns CENTER_INACTIVE for a deactivated center', async () => {
      await ctx.services.centers.update(ctx.center.id, { is_active: false });
      const r = await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      assert.equal(r.status, 409);
      assert.equal(r.json.code, 'CENTER_INACTIVE');
    });

    async function registerExtraStudent() {
      await h.seedStudent({ email: 'stu3@example.com', password: 'Stud1234x', fullName: 'Student Three' });
      return h.loginAs('stu3@example.com', 'Stud1234x');
    }
  });

  describe('my registrations and cancelling', () => {
    it('GET /api/registration/mine returns only the caller\'s registrations, with pagination', async () => {
      await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      await s2('POST', '/api/registration', { slot_id: ctx.slot.id });
      const mine = await s1('GET', '/api/registration/mine');
      assert.equal(mine.status, 200);
      assert.deepEqual([mine.json.data.total, mine.json.data.registrations.length, mine.json.data.page, mine.json.data.limit], [1, 1, 1, 20]);
      assert.equal(mine.json.data.registrations[0].center.city, 'Vijayawada');
      assert.equal((await s1('GET', '/api/registration/mine?limit=0')).status, 422);
      assert.equal((await s1('GET', '/api/registration/mine?page=x')).status, 422);
    });

    it('DELETE cancels my registration; again is 409; someone else\'s is 404', async () => {
      const mine = (await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.data.registration;

      const intruder = await s2('DELETE', `/api/registration/${mine.id}`);
      assert.equal(intruder.status, 404);
      assert.equal(intruder.json.code, 'REGISTRATION_NOT_FOUND');
      assert.equal(h.db.registrations[0].status, 'completed');

      const ok = await s1('DELETE', `/api/registration/${mine.id}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.json.data.registration.status, 'cancelled');

      const again = await s1('DELETE', `/api/registration/${mine.id}`);
      assert.equal(again.status, 409);
      assert.equal(again.json.code, 'ALREADY_CANCELLED');

      assert.equal((await s1('DELETE', '/api/registration/99999')).status, 404);
      for (const id of ['abc', '0', '-2']) assert.equal((await s1('DELETE', `/api/registration/${id}`)).status, 422, id);
    });

    it('cancelling is refused once registration has closed (409 CANCELLATION_CLOSED)', async () => {
      const mine = (await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.data.registration;
      h.db.examinations[0].registration_end_date = '2026-10-06 10:00:00';
      const r = await s1('DELETE', `/api/registration/${mine.id}`);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, 'CANCELLATION_CLOSED');
    });

    it('a student can register again after cancelling', async () => {
      const first = (await s1('POST', '/api/registration', { slot_id: ctx.slot.id })).json.data.registration;
      await s1('DELETE', `/api/registration/${first.id}`);
      const second = await s1('POST', '/api/registration', { slot_id: ctx.slot.id });
      assert.equal(second.status, 201);
      assert.notEqual(second.json.data.registration.id, first.id);
      assert.equal((await s1('GET', '/api/registration/mine')).json.data.total, 2);
    });
  });
});
