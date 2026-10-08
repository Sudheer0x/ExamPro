// Phase 3C against a REAL MySQL database (the throw-away "_test" database). Start with: npm run test:db
//
// This is where the overbooking guarantee is actually proved: many registrations fired at the same moment
// against the real locks, the real unique keys and the real SQL.

const db = require('./dbHarness'); // FIRST: refuses to continue unless this is a *_test database
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { pool } = require('../../src/config/database');
const exams = require('../../src/services/examinationService');
const centers = require('../../src/services/centerService');
const slots = require('../../src/services/slotService');
const catalog = require('../../src/services/catalogService');
const registrations = require('../../src/services/registrationService');

const sql = async (text, params) => (await pool.query(text, params))[0];
const when = async (days) => (await sql("SELECT DATE_FORMAT(NOW() + INTERVAL ? DAY, '%Y-%m-%d %H:%i:%s') AS t", [days]))[0].t;
const dayOf = async (days) => (await when(days)).slice(0, 10);

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, `expected HTTP ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.extra && err.extra.code, code, `expected ${code}, got ${err.extra && err.extra.code}: ${err.message}`);
    return true;
  });
}

let counter = 0;
async function makeStudents(n) {
  const ids = [];
  for (let i = 0; i < n; i += 1) {
    counter += 1;
    const [r] = await pool.query(
      'INSERT INTO students (full_name, email, mobile_number, password_hash, email_verified) VALUES (?, ?, ?, ?, 1)',
      [`Student ${counter}`, `student${counter}@example.com`, '9876543210', 'not-a-real-hash']
    );
    ids.push(r.insertId);
  }
  return ids;
}

/** An OPEN exam with one slot, built through the real admin services. */
async function openExam({ capacity = 3, pcs = 20, fee = '0.00', regStartDays = -1, regEndDays = 30, slotDays = 60, open = true, name = 'ExamPro CBT 2026' } = {}) {
  const exam = await exams.create({
    exam_name: name,
    registration_start_date: await when(regStartDays),
    registration_end_date: await when(regEndDays),
    exam_duration_minutes: 180,
    fee,
  });
  const center = await centers.create({ center_name: `Centre ${++counter}`, city: 'Vijayawada', state: 'Andhra Pradesh', address: 'MG Road' });
  await centers.bulkCreateComputers(center.id, { count: pcs });
  const slot = await slots.create(exam.id, { center_id: center.id, exam_date: await dayOf(slotDays), slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity });
  if (open) await exams.changeStatus(exam.id, 'registration_open');
  return { exam, center, slot };
}

const settle = (promises) => Promise.allSettled(promises);
const codeOf = (r) => (r.status === 'rejected' ? r.reason && r.reason.extra && r.reason.extra.code : null);

describe('Phase 3C against a real database', () => {
  before(() => db.setupDatabase());
  beforeEach(() => db.resetData());
  after(() => db.closePool());

  describe('concurrency (the overbooking guarantee)', () => {
    it('capacity 3, 10 students at the same moment: exactly 3 succeed and 7 get SLOT_FULL (repeated 5 times)', async () => {
      const students = await makeStudents(10);
      for (let round = 1; round <= 5; round += 1) {
        const { slot } = await openExam({ capacity: 3, name: `Round ${round}` });
        const results = await settle(students.map((id) => registrations.register(id, slot.id)));

        const ok = results.filter((r) => r.status === 'fulfilled');
        const full = results.filter((r) => codeOf(r) === 'SLOT_FULL');
        assert.equal(ok.length, 3, `round ${round}: ${JSON.stringify(results.map((r) => r.status === 'fulfilled' ? 'ok' : codeOf(r)))}`);
        assert.equal(full.length, 7, `round ${round}: the other 7 must all be SLOT_FULL`);

        const [{ active }] = await sql("SELECT COUNT(*) AS active FROM registrations r JOIN candidate_allocations ca ON ca.registration_id = r.id WHERE ca.exam_slot_id = ? AND r.status <> 'cancelled'", [slot.id]);
        assert.equal(Number(active), 3, `round ${round}: never more than the capacity in the database`);
      }
    });

    it('the same student clicking 5 times at once gets exactly one registration', async () => {
      const [student] = await makeStudents(1);
      const { slot } = await openExam({ capacity: 10 });
      const results = await settle(Array.from({ length: 5 }, () => registrations.register(student, slot.id)));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => codeOf(r) === 'DUPLICATE_REGISTRATION').length, 4);
      assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM registrations WHERE student_id = ?', [student]))[0].n), 1);
    });

    it('one student racing for two different slots of the same exam still gets only one registration', async () => {
      const [student] = await makeStudents(1);
      const { exam, center, slot } = await openExam({ capacity: 10 });
      const other = await slots.create(exam.id, { center_id: center.id, exam_date: await dayOf(61), slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 10 });
      const results = await settle([registrations.register(student, slot.id), registrations.register(student, other.id)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => codeOf(r) === 'DUPLICATE_REGISTRATION').length, 1);
      assert.equal(Number((await sql("SELECT COUNT(*) AS n FROM registrations WHERE student_id = ? AND status <> 'cancelled'", [student]))[0].n), 1);
    });

    it('twelve simultaneous registrations all get their own real codes (no placeholders, no duplicates)', async () => {
      const students = await makeStudents(12);
      const { slot } = await openExam({ capacity: 12, pcs: 20 });
      const results = await settle(students.map((id) => registrations.register(id, slot.id)));
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 12);
      const rows = await sql('SELECT registration_id, application_id FROM registrations');
      assert.equal(new Set(rows.map((r) => r.registration_id)).size, 12);
      assert.equal(new Set(rows.map((r) => r.application_id)).size, 12);
      for (const r of rows) {
        assert.match(r.registration_id, /^EXP\d{4}\d{6}$/);
        assert.match(r.application_id, /^APP\d{4}\d{6}$/);
      }
    });

    it('after a cancellation the freed seat goes to exactly one of two simultaneous students', async () => {
      const [a, b, c] = await makeStudents(3);
      const { slot } = await openExam({ capacity: 1 });
      const first = await registrations.register(a, slot.id);
      await rejectsWith(registrations.register(b, slot.id), 409, 'SLOT_FULL');
      await registrations.cancel(a, first.id);
      const results = await settle([registrations.register(b, slot.id), registrations.register(c, slot.id)]);
      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(results.filter((r) => codeOf(r) === 'SLOT_FULL').length, 1);
    });

    it('registrations running alongside admin changes finish without deadlocks or overbooking', async () => {
      const students = await makeStudents(8);
      const { exam, center, slot } = await openExam({ capacity: 6, pcs: 20 });
      const results = await settle([
        ...students.map((id) => registrations.register(id, slot.id)),
        slots.updateCapacity(slot.id, { capacity: 8 }),
        slots.updateCapacity(slot.id, { capacity: 8 }),
        centers.update(center.id, { address: 'New address' }),
        exams.update(exam.id, { description: 'Updated while students register' }),
      ]);
      const bad = results.filter((r) => r.status === 'rejected' && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(r.reason && r.reason.code));
      assert.equal(bad.length, 0, 'no deadlock or lock timeout may reach the caller');
      const [{ active }] = await sql("SELECT COUNT(*) AS active FROM candidate_allocations ca JOIN registrations r ON r.id = ca.registration_id WHERE ca.exam_slot_id = ? AND r.status <> 'cancelled'", [slot.id]);
      const [{ capacity }] = await sql('SELECT capacity FROM exam_slots WHERE id = ?', [slot.id]);
      assert.ok(Number(active) <= Number(capacity), `booked ${active} must not exceed capacity ${capacity}`);
    });
  });

  describe('migration 003 and the active-registration key', () => {
    it('is recorded, and the database itself allows many cancelled rows but only one active row', async () => {
      const [{ n }] = await sql("SELECT COUNT(*) AS n FROM schema_migrations WHERE filename = '003_phase3c_registration_rules.sql'");
      assert.equal(Number(n), 1);

      const [student] = await makeStudents(1);
      const { exam } = await openExam({ capacity: 5 });
      const insert = (status) => pool.query('INSERT INTO registrations (student_id, examination_id, registration_id, application_id, status) VALUES (?, ?, ?, ?, ?)', [student, exam.id, `X-${Math.random()}`, `Y-${Math.random()}`, status]);

      await insert('cancelled');
      await insert('cancelled');
      await insert('completed');
      await assert.rejects(insert('pending_payment'), (err) => err.code === 'ER_DUP_ENTRY' && /uq_student_exam_active/.test(err.message));
      await insert('cancelled');
      assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM registrations WHERE student_id = ?', [student]))[0].n), 4);
    });

    it('can be run again safely, and upgrades a database that still has the old one-row-ever key', async () => {
      const text = fs.readFileSync(path.join(db.backend, 'database', 'migrations', '003_phase3c_registration_rules.sql'), 'utf8');
      const conn = await db.openConnection();
      try {
        await conn.query(text); // already applied: must change nothing and not fail

        // roll back to the pre-003 shape
        await conn.query('ALTER TABLE registrations ADD UNIQUE KEY uq_student_examination (student_id, examination_id)');
        await conn.query('ALTER TABLE registrations DROP INDEX uq_student_exam_active');
        await conn.query('ALTER TABLE registrations DROP COLUMN active_flag');

        await conn.query(text); // the real upgrade

        const [[col]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'active_flag'");
        const [[neu]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND INDEX_NAME = 'uq_student_exam_active'");
        const [[old]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND INDEX_NAME = 'uq_student_examination'");
        assert.equal(Number(col.n), 1);
        assert.ok(Number(neu.n) >= 1);
        assert.equal(Number(old.n), 0);
      } finally {
        await conn.end();
      }
    });
  });

  describe('registration rules with real SQL', () => {
    it('registers, stores the allocation from the slot, and sets the status from the fee', async () => {
      const [s1, s2] = await makeStudents(2);
      const free = await openExam({ capacity: 5, fee: '0.00', name: 'Free exam' });
      const paid = await openExam({ capacity: 5, fee: '500.00', name: 'Paid exam' });

      const a = await registrations.register(s1, free.slot.id);
      const b = await registrations.register(s2, paid.slot.id);
      assert.equal(a.status, 'completed');
      assert.equal(b.status, 'pending_payment');
      assert.match(a.registration_id, /^EXP\d{4}\d{6}$/);

      const [alloc] = await sql('SELECT exam_center_id, exam_slot_id FROM candidate_allocations WHERE registration_id = ?', [a.id]);
      assert.deepEqual([alloc.exam_center_id, alloc.exam_slot_id], [free.center.id, free.slot.id]);
      assert.equal((await catalog.listSlots(paid.exam.id, {})).slots[0].seats_left, 4, 'a pending_payment registration holds its seat');
    });

    it('enforces the registration window, the slot time, the exam status and the center', async () => {
      const [student] = await makeStudents(1);

      const later = await openExam({ regStartDays: 5, name: 'Starts later' });
      await rejectsWith(registrations.register(student, later.slot.id), 409, 'REGISTRATION_NOT_STARTED');

      const ended = await openExam({ name: 'Ended' });
      await sql('UPDATE examinations SET registration_end_date = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [ended.exam.id]);
      await rejectsWith(registrations.register(student, ended.slot.id), 409, 'REGISTRATION_CLOSED');

      const started = await openExam({ name: 'Slot started' });
      await sql('UPDATE exam_slots SET exam_date = DATE(NOW() - INTERVAL 1 DAY) WHERE id = ?', [started.slot.id]);
      await rejectsWith(registrations.register(student, started.slot.id), 409, 'SLOT_STARTED');

      const closed = await openExam({ name: 'Closed' });
      await exams.changeStatus(closed.exam.id, 'registration_closed');
      await rejectsWith(registrations.register(student, closed.slot.id), 409, 'REGISTRATION_NOT_OPEN');

      const draft = await openExam({ name: 'Draft', open: false });
      await rejectsWith(registrations.register(student, draft.slot.id), 404, 'SLOT_NOT_FOUND');

      const inactive = await openExam({ name: 'Inactive center' });
      await sql('UPDATE exam_centers SET is_active = 0 WHERE id = ?', [inactive.center.id]);
      await rejectsWith(registrations.register(student, inactive.slot.id), 409, 'CENTER_INACTIVE');

      await rejectsWith(registrations.register(student, 999999), 404, 'SLOT_NOT_FOUND');
      assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM registrations'))[0].n), 0);
    });

    it('a cancelled registration frees its seat, allows registering again, and never blocks forever', async () => {
      const [student, other] = await makeStudents(2);
      const { slot } = await openExam({ capacity: 1 });
      const first = await registrations.register(student, slot.id);
      const cancelled = await registrations.cancel(student, first.id);
      assert.deepEqual([cancelled.status, cancelled.slot, cancelled.center], ['cancelled', null, null]);
      assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM candidate_allocations'))[0].n), 0);

      const again = await registrations.register(student, slot.id);
      assert.notEqual(again.id, first.id);
      await rejectsWith(registrations.register(other, slot.id), 409, 'SLOT_FULL');
      assert.equal(Number((await sql('SELECT COUNT(*) AS n FROM registrations WHERE student_id = ?', [student]))[0].n), 2);
    });

    it('cancellation rules: ownership, twice, after the window, payment received', async () => {
      const [owner, intruder] = await makeStudents(2);
      const { exam, slot } = await openExam({ capacity: 5, fee: '500.00' });
      const reg = await registrations.register(owner, slot.id);

      await rejectsWith(registrations.cancel(intruder, reg.id), 404, 'REGISTRATION_NOT_FOUND');
      await rejectsWith(registrations.cancel(owner, 999999), 404, 'REGISTRATION_NOT_FOUND');

      await sql("INSERT INTO payments (registration_id, student_id, amount, status) VALUES (?, ?, 500.00, 'successful')", [reg.id, owner]);
      await rejectsWith(registrations.cancel(owner, reg.id), 409, 'PAYMENT_RECEIVED');
      await sql('DELETE FROM payments');

      await sql('UPDATE examinations SET registration_end_date = NOW() - INTERVAL 1 MINUTE WHERE id = ?', [exam.id]);
      await rejectsWith(registrations.cancel(owner, reg.id), 409, 'CANCELLATION_CLOSED');
      await sql('UPDATE examinations SET registration_end_date = NOW() + INTERVAL 30 DAY WHERE id = ?', [exam.id]);

      await registrations.cancel(owner, reg.id);
      await rejectsWith(registrations.cancel(owner, reg.id), 409, 'ALREADY_CANCELLED');
    });
  });

  describe('student views with real SQL', () => {
    it('lists only visible exams, open first, with search (a % is literal) and pagination', async () => {
      await openExam({ name: 'Open exam' });
      await openExam({ name: 'Draft exam', open: false });
      const closed = await openExam({ name: 'Closed 100% exam' });
      await exams.changeStatus(closed.exam.id, 'registration_closed');

      const all = await catalog.listExams({ page: 1, limit: 20 });
      assert.deepEqual(all.examinations.map((e) => e.exam_name), ['Open exam', 'Closed 100% exam']);
      assert.deepEqual([all.examinations[0].registration_state, all.examinations[0].can_register], ['open', true]);
      assert.equal((await catalog.listExams({ page: 1, limit: 20, q: '100%' })).total, 1);
      assert.equal((await catalog.listExams({ page: 1, limit: 20, q: '%' })).total, 1);
      assert.equal((await catalog.listExams({ page: 2, limit: 1 })).examinations.length, 1);
    });

    it('shows exam details (404 for drafts), and my_registration', async () => {
      const [student, other] = await makeStudents(2);
      const { exam, slot } = await openExam({ capacity: 5 });
      const draft = await openExam({ name: 'Draft', open: false });
      await rejectsWith(catalog.getExam(student, draft.exam.id), 404);
      await rejectsWith(catalog.getExam(student, 999999), 404);

      assert.equal((await catalog.getExam(student, exam.id)).examination.my_registration, null);
      const reg = await registrations.register(student, slot.id);
      assert.equal((await catalog.getExam(student, exam.id)).examination.my_registration.id, reg.id);
      assert.equal((await catalog.getExam(other, exam.id)).examination.my_registration, null);
    });

    it('lists upcoming slots at active centers with exact seat counts (cancelled bookings free seats)', async () => {
      const [a, b, c] = await makeStudents(3);
      const { exam, center, slot } = await openExam({ capacity: 3 });
      const ra = await registrations.register(a, slot.id);
      await registrations.register(b, slot.id);
      await registrations.cancel(a, ra.id);

      const [row] = (await catalog.listSlots(exam.id, {})).slots;
      assert.deepEqual([row.capacity, row.booked_count, row.seats_left, row.is_full], [3, 1, 2, false]);
      assert.deepEqual([row.center_name, row.city, row.state, row.address], [center.center_name, 'Vijayawada', 'Andhra Pradesh', 'MG Road']);
      assert.equal((await catalog.listSlots(exam.id, { center_id: center.id, date: await dayOf(60) })).slots.length, 1);
      assert.equal((await catalog.listSlots(exam.id, { date: await dayOf(61) })).slots.length, 0);

      await registrations.register(c, slot.id);
      await sql('UPDATE exam_slots SET exam_date = DATE(NOW() - INTERVAL 1 DAY) WHERE id = ?', [slot.id]);
      assert.equal((await catalog.listSlots(exam.id, {})).slots.length, 0, 'a slot that has started is not offered');
    });

    it('hides slots at a deactivated center, and my registrations are private and paginated', async () => {
      const [a, b] = await makeStudents(2);
      const one = await openExam({ capacity: 5, name: 'Exam one' });
      const two = await openExam({ capacity: 5, name: 'Exam two' });
      await registrations.register(a, one.slot.id);
      await registrations.register(a, two.slot.id);
      await registrations.register(b, one.slot.id);

      const mine = await registrations.listMine(a, { page: 1, limit: 20 });
      assert.equal(mine.total, 2);
      assert.deepEqual(mine.registrations.map((r) => r.examination.exam_name), ['Exam two', 'Exam one']);
      assert.equal((await registrations.listMine(a, { page: 2, limit: 1 })).registrations[0].examination.exam_name, 'Exam one');
      assert.equal((await registrations.listMine(b, { page: 1, limit: 20 })).total, 1);

      await sql('UPDATE exam_centers SET is_active = 0 WHERE id = ?', [one.center.id]);
      assert.equal((await catalog.listSlots(one.exam.id, {})).slots.length, 0);
    });
  });
});
