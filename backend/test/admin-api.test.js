// Phase 3B admin API over real HTTP: routing, validation, controllers, envelopes and error codes.
// (Database faked; business rules are covered in depth by admin-services.test.js.)
const h = require('./support/harness');
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

describe('Phase 3B admin API', () => {
  let token;
  const api = (method, url, body) => h.request(method, url, { token, body });

  before(async () => {
    await h.start();
    h.resetDb();
    await h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' });
    token = (await h.loginAs('admin@example.com', 'Admin1234')).token;
  });
  after(() => h.stop());

  const EXAM = {
    exam_name: 'ExamPro CBT 2026',
    registration_start_date: '2026-10-01 09:00:00',
    registration_end_date: '2026-10-31 23:59:59',
    exam_duration_minutes: 180,
    fee: 500,
  };

  async function newExam(over = {}) { return (await api('POST', '/api/admin/examinations', { ...EXAM, ...over })).json.data.examination; }
  async function newCenter(pcs = 60) {
    const c = (await api('POST', '/api/admin/centers', { center_name: 'ExamPro Centre - Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh' })).json.data.center;
    if (pcs) await api('POST', `/api/admin/centers/${c.id}/computers`, { count: pcs });
    return c;
  }
  const slotBody = (centerId, over = {}) => ({ center_id: centerId, exam_date: '2026-12-14', slot_start_time: '09:00', slot_end_time: '12:30', capacity: 40, ...over });

  describe('examinations', () => {
    beforeEach(() => { h.resetDb(); return h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' }); });

    it('POST creates a draft exam (201) with a clean envelope and normalised values', async () => {
      const r = await api('POST', '/api/admin/examinations', { ...EXAM, registration_start_date: '2026-10-01T09:00' });
      assert.equal(r.status, 201);
      assert.equal(r.json.success, true);
      assert.equal(r.json.message, 'Examination created');
      const e = r.json.data.examination;
      assert.equal(e.status, 'draft');
      assert.equal(e.fee, '500.00');
      assert.equal(e.registration_start_date, '2026-10-01 09:00:00');
      assert.equal(e.timezone, h.config.db.timeZone);
    });

    it('POST rejects bad input with 422 and field-level errors', async () => {
      for (const [over, field] of [
        [{ exam_name: 'ab' }, 'exam_name'],
        [{ registration_end_date: 'next week' }, 'registration_end_date'],
        [{ registration_start_date: '2026-02-30 09:00:00' }, 'registration_start_date'],
        [{ exam_duration_minutes: 0 }, 'exam_duration_minutes'],
        [{ exam_duration_minutes: 99999 }, 'exam_duration_minutes'],
        [{ fee: 500.123 }, 'fee'],
        [{ fee: -5 }, 'fee'],
        [{ description: 12345 }, 'description'],
      ]) {
        const r = await api('POST', '/api/admin/examinations', { ...EXAM, ...over });
        assert.equal(r.status, 422, JSON.stringify(over));
        assert.equal(r.json.success, false);
        assert.ok(r.json.errors.some((e) => e.field === field), `${field} should be reported for ${JSON.stringify(over)}`);
      }
      const { exam_name, ...missing } = EXAM;
      assert.equal((await api('POST', '/api/admin/examinations', missing)).status, 422);
    });

    it('POST rejects unknown fields (no mass-assignment of status)', async () => {
      const r = await api('POST', '/api/admin/examinations', { ...EXAM, status: 'registration_open' });
      assert.equal(r.status, 422);
      assert.match(r.json.message, /Unexpected field/);
    });

    it('POST rejects a window that closes before it opens (422 INVALID_WINDOW)', async () => {
      const r = await api('POST', '/api/admin/examinations', { ...EXAM, registration_end_date: '2026-09-01 00:00:00' });
      assert.equal(r.status, 422);
      assert.equal(r.json.code, 'INVALID_WINDOW');
    });

    it('GET list and GET one work, with pagination info and a slots summary', async () => {
      await newExam({ exam_name: 'Alpha exam' });
      const b = await newExam({ exam_name: 'Bravo exam' });
      const list = await api('GET', '/api/admin/examinations?limit=1&page=1');
      assert.equal(list.status, 200);
      assert.deepEqual([list.json.data.page, list.json.data.limit, list.json.data.total, list.json.data.examinations.length], [1, 1, 2, 1]);
      assert.equal(list.json.data.examinations[0].slot_count, 0);
      const one = await api('GET', `/api/admin/examinations/${b.id}`);
      assert.deepEqual(one.json.data.slots_summary, { count: 0, total_capacity: 0 });
      assert.equal((await api('GET', '/api/admin/examinations/9999')).status, 404);
      assert.equal((await api('GET', '/api/admin/examinations/abc')).status, 422);
      assert.equal((await api('GET', '/api/admin/examinations/0')).status, 422);
      assert.equal((await api('GET', '/api/admin/examinations?limit=1000')).status, 422);
      assert.equal((await api('GET', '/api/admin/examinations?status=nonsense')).status, 422);
    });

    it('PATCH edits fields, clears text with null, and needs at least one field', async () => {
      const e = await newExam({ description: 'Old text' });
      const r = await api('PATCH', `/api/admin/examinations/${e.id}`, { exam_name: 'Renamed exam', description: null });
      assert.equal(r.status, 200);
      assert.equal(r.json.data.examination.exam_name, 'Renamed exam');
      assert.equal(r.json.data.examination.description, null);
      assert.equal((await api('PATCH', `/api/admin/examinations/${e.id}`, {})).status, 422);
      assert.equal((await api('PATCH', `/api/admin/examinations/${e.id}`, { status: 'scheduled' })).status, 422); // status has its own endpoint
    });

    it('PATCH /status enforces the status machine with machine-readable codes', async () => {
      const e = await newExam();
      const noSlots = await api('PATCH', `/api/admin/examinations/${e.id}/status`, { status: 'registration_open' });
      assert.equal(noSlots.status, 409);
      assert.equal(noSlots.json.code, 'NO_SLOTS');
      const jump = await api('PATCH', `/api/admin/examinations/${e.id}/status`, { status: 'completed' });
      assert.equal(jump.status, 409);
      assert.equal(jump.json.code, 'INVALID_TRANSITION');
      assert.deepEqual(jump.json.details.allowed, ['registration_open']);
      assert.equal((await api('PATCH', `/api/admin/examinations/${e.id}/status`, { status: 'bogus' })).status, 422);

      const c = await newCenter();
      assert.equal((await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id))).status, 201);
      const open = await api('PATCH', `/api/admin/examinations/${e.id}/status`, { status: 'registration_open' });
      assert.equal(open.status, 200);
      assert.equal(open.json.data.examination.status, 'registration_open');
    });
  });

  describe('centers and computers', () => {
    beforeEach(() => { h.resetDb(); return h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' }); });

    it('POST /centers creates a center (201); is_active cannot be set at creation', async () => {
      const r = await api('POST', '/api/admin/centers', { center_name: 'ExamPro Centre - Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', address: 'MG Road' });
      assert.equal(r.status, 201);
      assert.deepEqual([r.json.data.center.total_computers, r.json.data.center.working_computers, r.json.data.center.is_active], [0, 0, true]);
      assert.equal((await api('POST', '/api/admin/centers', { center_name: 'X', city: 'Vijayawada', state: 'AP' })).status, 422); // name too short
      assert.equal((await api('POST', '/api/admin/centers', { center_name: 'Centre', city: 'Vijayawada', state: 'AP', is_active: false })).status, 422);
    });

    it('GET list / GET one / PATCH / DELETE', async () => {
      const c = await newCenter(0);
      const list = await api('GET', '/api/admin/centers?city=Vijayawada&is_active=true');
      assert.equal(list.json.data.total, 1);
      assert.equal((await api('GET', '/api/admin/centers?is_active=maybe')).status, 422);
      assert.equal((await api('GET', `/api/admin/centers/${c.id}`)).json.data.upcoming_slot_count, 0);
      const patched = await api('PATCH', `/api/admin/centers/${c.id}`, { city: 'Amaravati', is_active: false });
      assert.deepEqual([patched.status, patched.json.data.center.city, patched.json.data.center.is_active], [200, 'Amaravati', false]);
      assert.equal((await api('PATCH', `/api/admin/centers/${c.id}`, {})).status, 422);
      assert.equal((await api('DELETE', `/api/admin/centers/${c.id}`)).status, 200);
      assert.equal((await api('GET', `/api/admin/centers/${c.id}`)).status, 404);
    });

    it('POST /computers creates numbered PCs (201); bad input is 422; clashes are 409', async () => {
      const c = await newCenter(0);
      const r = await api('POST', `/api/admin/centers/${c.id}/computers`, { count: 60 });
      assert.equal(r.status, 201);
      assert.deepEqual([r.json.data.created, r.json.data.first_label, r.json.data.last_label], [60, 'PC-001', 'PC-060']);
      assert.deepEqual([r.json.data.center.total_computers, r.json.data.center.working_computers], [60, 60]);

      assert.equal((await api('POST', `/api/admin/centers/${c.id}/computers`, { count: 0 })).status, 422);
      assert.equal((await api('POST', `/api/admin/centers/${c.id}/computers`, { count: h.config.limits.maxPcsPerRequest + 1 })).status, 422);
      assert.equal((await api('POST', `/api/admin/centers/${c.id}/computers`, { count: 5, prefix: "PC'; DROP" })).status, 422);
      assert.equal((await api('POST', `/api/admin/centers/${c.id}/computers`, { count: 5, colour: 'red' })).status, 422);
      const clash = await api('POST', `/api/admin/centers/${c.id}/computers`, { count: 5, start_number: 58 });
      assert.equal(clash.status, 409);
      assert.equal(clash.json.code, 'PC_LABEL_EXISTS');
      assert.equal((await api('POST', '/api/admin/centers/9999/computers', { count: 5 })).status, 404);
    });

    it('GET / PATCH / DELETE a single PC', async () => {
      const c = await newCenter(5);
      const list = await api('GET', `/api/admin/centers/${c.id}/computers?limit=2`);
      assert.deepEqual([list.json.data.computers.length, list.json.data.total], [2, 5]);
      const pc = list.json.data.computers[0];
      const out = await api('PATCH', `/api/admin/centers/${c.id}/computers/${pc.id}`, { status: 'maintenance' });
      assert.equal(out.status, 200);
      assert.deepEqual([out.json.data.computer.status, out.json.data.center.working_computers], ['maintenance', 4]);
      assert.equal((await api('PATCH', `/api/admin/centers/${c.id}/computers/${pc.id}`, { status: 'allocated' })).status, 422); // only Phase 5 may set that
      assert.equal((await api('GET', `/api/admin/centers/${c.id}/computers?status=bogus`)).status, 422);
      const del = await api('DELETE', `/api/admin/centers/${c.id}/computers/${pc.id}`);
      assert.equal(del.status, 200);
      assert.equal(del.json.data.center.total_computers, 4);
      assert.equal((await api('DELETE', `/api/admin/centers/${c.id}/computers/${pc.id}`)).status, 404);
    });
  });

  describe('slots', () => {
    beforeEach(() => { h.resetDb(); return h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' }); });

    it('POST creates a slot (201) with seat counts; GET lists it', async () => {
      const e = await newExam();
      const c = await newCenter();
      const r = await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id));
      assert.equal(r.status, 201);
      assert.deepEqual([r.json.data.slot.capacity, r.json.data.slot.booked_count, r.json.data.slot.seats_left], [40, 0, 40]);
      assert.deepEqual([r.json.data.slot.slot_start_time, r.json.data.slot.slot_end_time], ['09:00:00', '12:30:00']);
      const list = await api('GET', `/api/admin/examinations/${e.id}/slots?center_id=${c.id}&date=2026-12-14`);
      assert.equal(list.json.data.slots.length, 1);
      assert.equal((await api('GET', `/api/admin/examinations/${e.id}/slots?date=14-12-2026`)).status, 422);
      assert.equal((await api('GET', '/api/admin/examinations/9999/slots')).status, 404);
    });

    it('POST accepts a future slot while registration is still open', async () => {
      const e = await newExam(); // registration closes 2026-10-31 23:59:59
      const c = await newCenter();
      assert.equal((await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id))).status, 201);
      assert.equal((await api('PATCH', `/api/admin/examinations/${e.id}/status`, { status: 'registration_open' })).status, 200);
      const early = await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, { exam_date: '2026-10-20', capacity: 20 }));
      assert.equal(early.status, 201);
      assert.equal(early.json.data.slot.exam_date, '2026-10-20');
      const past = await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, { exam_date: '2026-10-05' }));
      assert.equal(past.status, 422);
      assert.equal(past.json.code, 'SLOT_IN_PAST');
    });

    it('POST validates input', async () => {
      const e = await newExam();
      const c = await newCenter();
      for (const over of [{ exam_date: '2026-13-40' }, { slot_start_time: '9am' }, { slot_end_time: '25:00' }, { capacity: 0 }, { capacity: 'many' }, { center_id: 'x' }]) {
        assert.equal((await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, over))).status, 422, JSON.stringify(over));
      }
      assert.equal((await api('POST', `/api/admin/examinations/${e.id}/slots`, { ...slotBody(c.id), extra: 1 })).status, 422);
    });

    it('POST explains capacity conflicts with an error code and exact numbers', async () => {
      const e = await newExam();
      const c = await newCenter(60);
      await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, { capacity: 40 }));
      const r = await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, { slot_start_time: '11:00', slot_end_time: '14:30', capacity: 30 }));
      assert.equal(r.status, 409);
      assert.equal(r.json.success, false);
      assert.equal(r.json.code, 'CAPACITY_EXCEEDED');
      assert.deepEqual(r.json.details, { working_computers: 60, overlapping_capacity: 40, requested: 30, available: 20 });
      const dup = await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id, { capacity: 5 }));
      assert.equal(dup.json.code, 'SLOT_EXISTS');
    });

    it('PATCH changes capacity; DELETE removes an unused slot', async () => {
      const e = await newExam();
      const c = await newCenter(60);
      const s = (await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id))).json.data.slot;
      const patched = await api('PATCH', `/api/admin/slots/${s.id}`, { capacity: 55 });
      assert.deepEqual([patched.status, patched.json.data.slot.capacity], [200, 55]);
      assert.equal((await api('PATCH', `/api/admin/slots/${s.id}`, { capacity: 61 })).json.code, 'CAPACITY_EXCEEDED');
      assert.equal((await api('PATCH', `/api/admin/slots/${s.id}`, { capacity: 0 })).status, 422);
      assert.equal((await api('PATCH', `/api/admin/slots/${s.id}`, { exam_date: '2026-12-20' })).status, 422); // only capacity is editable
      assert.equal((await api('DELETE', `/api/admin/slots/${s.id}`)).status, 200);
      assert.equal((await api('DELETE', `/api/admin/slots/${s.id}`)).status, 404);
    });

    it('DELETE refuses a slot that has candidates (409 SLOT_IN_USE)', async () => {
      const e = await newExam();
      const c = await newCenter();
      const s = (await api('POST', `/api/admin/examinations/${e.id}/slots`, slotBody(c.id))).json.data.slot;
      h.db.allocations.push({ id: 1, exam_slot_id: s.id, exam_center_id: c.id, registration_status: 'completed' });
      const r = await api('DELETE', `/api/admin/slots/${s.id}`);
      assert.equal(r.status, 409);
      assert.equal(r.json.code, 'SLOT_IN_USE');
    });
  });
});
