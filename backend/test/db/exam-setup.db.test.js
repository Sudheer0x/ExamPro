// Phase 3B against a REAL MySQL database (the throw-away "_test" database). Start with: npm run test:db
//
// What the in-memory tests cannot prove, these do: the SQL itself, the CHECK / unique / foreign-key
// rules in migration 002, the upgrade path of that migration, the time-zone policy, and that the
// locking really stops concurrent requests from overbooking a center.

const db = require('./dbHarness'); // FIRST: refuses to continue unless this is a *_test database
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { pool } = require('../../src/config/database');
const config = require('../../src/config/env');
const { parseOffsetMinutes } = require('../../src/utils/timezone');
const { runMigrations } = require('../../scripts/migrate');
const exams = require('../../src/services/examinationService');
const centers = require('../../src/services/centerService');
const slots = require('../../src/services/slotService');

const sql = async (text, params) => (await pool.query(text, params))[0];
const when = async (days) => (await sql("SELECT DATE_FORMAT(NOW() + INTERVAL ? DAY, '%Y-%m-%d %H:%i:%s') AS t", [days]))[0].t;

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, `expected HTTP ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.extra && err.extra.code, code, `expected ${code}, got ${err.extra && err.extra.code}: ${err.message}`);
    return true;
  });
}

async function makeExam(over = {}) {
  return exams.create({
    exam_name: 'ExamPro CBT 2026',
    registration_start_date: await when(-1),
    registration_end_date: await when(30),
    exam_duration_minutes: 180,
    fee: '500.00',
    ...over,
  });
}
async function makeCenter(pcs = 60, over = {}) {
  const c = await centers.create({ center_name: 'ExamPro Centre - Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', ...over });
  if (pcs) await centers.bulkCreateComputers(c.id, { count: pcs });
  return c;
}
async function slotDay() { return (await when(60)).slice(0, 10); }
const slotInput = async (centerId, over = {}) => ({ center_id: centerId, exam_date: await slotDay(), slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 40, ...over });

// A booked candidate, created with plain SQL (Phase 3C will do this through its own service).
async function bookCandidate(examId, centerId, slotId, n = 1, status = 'completed') {
  const [student] = await pool.query(
    'INSERT INTO students (full_name, email, mobile_number, password_hash, email_verified) VALUES (?, ?, ?, ?, 1)',
    [`Student ${n}`, `student${n}@example.com`, '9876543210', 'not-a-real-hash']
  );
  const [reg] = await pool.query(
    'INSERT INTO registrations (student_id, examination_id, registration_id, application_id, status) VALUES (?, ?, ?, ?, ?)',
    [student.insertId, examId, `EXP-T-${n}`, `APP-T-${n}`, status]
  );
  await pool.query('INSERT INTO candidate_allocations (registration_id, exam_center_id, exam_slot_id) VALUES (?, ?, ?)', [reg.insertId, centerId, slotId]);
  return reg.insertId;
}

describe('Phase 3B against a real database', () => {
  before(() => db.setupDatabase());
  beforeEach(() => db.resetData());
  after(() => db.closePool());

  describe('migrations and constraints', () => {
    it('records every migration as applied, and a second run changes nothing', async () => {
      const rows = await sql('SELECT filename FROM schema_migrations ORDER BY id');
      assert.deepEqual(rows.map((r) => r.filename), ['001_phase2_auth.sql', '002_phase3b_exam_setup.sql', '003_phase3c_registration_rules.sql']);
      const conn = await db.openConnection();
      try {
        const again = await runMigrations(conn, { log: () => {} });
        assert.deepEqual([again.applied, again.adopted], [[], []]);
      } finally {
        await conn.end();
      }
    });

    it('migration 002 can be run again safely on a database that already has it', async () => {
      const text = fs.readFileSync(path.join(db.backend, 'database', 'migrations', '002_phase3b_exam_setup.sql'), 'utf8');
      const conn = await db.openConnection();
      try {
        await conn.query(text);
        await conn.query(text);
      } finally {
        await conn.end();
      }
    });

    it('migration 002 upgrades a database that lacks its changes', async () => {
      const conn = await db.openConnection();
      try {
        // Roll the database back to its pre-002 shape. (A temporary index keeps the foreign key happy
        // while the new unique key is dropped; a legacy database has that index already.)
        await conn.query('ALTER TABLE exam_slots ADD INDEX tmp_slot_exam (examination_id)');
        await conn.query('ALTER TABLE exam_slots DROP INDEX uq_slot_exam_center_start');
        for (const check of ['chk_slot_times', 'chk_slot_capacity']) await conn.query(`ALTER TABLE exam_slots DROP CHECK ${check}`);
        for (const check of ['chk_exam_window', 'chk_exam_duration', 'chk_exam_fee']) await conn.query(`ALTER TABLE examinations DROP CHECK ${check}`);
        await conn.query('ALTER TABLE examinations DROP COLUMN fee');
        await conn.query('ALTER TABLE exam_centers DROP CHECK chk_center_counts');

        const text = fs.readFileSync(path.join(db.backend, 'database', 'migrations', '002_phase3b_exam_setup.sql'), 'utf8');
        await conn.query(text);
        await conn.query('ALTER TABLE exam_slots DROP INDEX tmp_slot_exam');

        const [checks] = await conn.query("SELECT CONSTRAINT_NAME AS n FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK'");
        const names = checks.map((r) => r.n);
        for (const expected of ['chk_slot_times', 'chk_slot_capacity', 'chk_exam_window', 'chk_exam_duration', 'chk_exam_fee', 'chk_center_counts']) {
          assert.ok(names.includes(expected), `${expected} should exist after the migration`);
        }
        const [[fee]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examinations' AND COLUMN_NAME = 'fee'");
        assert.equal(Number(fee.n), 1);
        const [[uq]] = await conn.query("SELECT COUNT(*) AS n FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_slots' AND INDEX_NAME = 'uq_slot_exam_center_start'");
        assert.ok(Number(uq.n) >= 1);
      } finally {
        await conn.end();
      }
    });

    it('the database itself enforces the slot, exam and center rules', async () => {
      const e = await makeExam();
      const c = await makeCenter(10);
      const day = await slotDay();
      const insertSlot = (start, end, capacity) =>
        pool.query('INSERT INTO exam_slots (examination_id, center_id, exam_date, slot_start_time, slot_end_time, capacity) VALUES (?, ?, ?, ?, ?, ?)', [e.id, c.id, day, start, end, capacity]);

      await insertSlot('09:00:00', '12:30:00', 5);
      await assert.rejects(insertSlot('09:00:00', '13:00:00', 5), (err) => err.code === 'ER_DUP_ENTRY'); // same exam, center, date, start
      await assert.rejects(insertSlot('14:00:00', '13:00:00', 5), (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'); // ends before it starts
      await assert.rejects(insertSlot('15:00:00', '15:00:00', 5), (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'); // zero length
      await assert.rejects(insertSlot('16:00:00', '19:00:00', 0), (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'); // no seats

      await assert.rejects(
        pool.query('INSERT INTO examinations (exam_name, registration_start_date, registration_end_date, exam_duration_minutes) VALUES (?, ?, ?, ?)', ['Bad window', '2026-11-30 00:00:00', '2026-11-01 00:00:00', 60]),
        (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
      );
      await assert.rejects(
        pool.query('INSERT INTO examinations (exam_name, registration_start_date, registration_end_date, exam_duration_minutes, fee) VALUES (?, ?, ?, ?, ?)', ['Negative fee', '2026-11-01 00:00:00', '2026-11-30 00:00:00', 60, -1]),
        (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED'
      );
      await assert.rejects(pool.query('UPDATE exam_centers SET available_computers = 99 WHERE id = ?', [c.id]), (err) => err.code === 'ER_CHECK_CONSTRAINT_VIOLATED');
    });

    it('foreign keys stop a booked slot or a used center from being removed behind our back', async () => {
      const e = await makeExam();
      const c = await makeCenter(10);
      const s = await slots.create(e.id, await slotInput(c.id, { capacity: 5 }));
      await bookCandidate(e.id, c.id, s.id);
      await assert.rejects(pool.query('DELETE FROM exam_slots WHERE id = ?', [s.id]), (err) => err.code === 'ER_ROW_IS_REFERENCED_2');
      await assert.rejects(pool.query('DELETE FROM exam_centers WHERE id = ?', [c.id]), (err) => err.code === 'ER_ROW_IS_REFERENCED_2');
    });
  });

  describe('time-zone policy', () => {
    it('every pooled connection runs in the configured business time zone', async () => {
      const [{ off }] = await sql('SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS off');
      assert.equal(Number(off), parseOffsetMinutes(config.db.timeZone));
    });
  });

  describe('examinations', () => {
    it('stores the fee as a two-decimal amount and lists/filters/gets exams', async () => {
      const e = await makeExam({ fee: '499.5' });
      assert.equal(e.fee, '499.50');
      assert.equal(e.status, 'draft');
      await makeExam({ exam_name: 'Another 100% exam' });
      assert.equal((await exams.list({ page: 1, limit: 20 })).total, 2);
      assert.equal((await exams.list({ page: 1, limit: 20, q: '100%' })).total, 1);
      assert.equal((await exams.list({ page: 1, limit: 20, q: '%' })).total, 1, 'a % in the search is taken literally');
      assert.equal((await exams.list({ page: 1, limit: 20, status: 'completed' })).total, 0);
      const one = await exams.get(e.id);
      assert.deepEqual(one.slots_summary, { count: 0, total_capacity: 0 });
      assert.equal(one.registration_count, 0);
    });

    it('runs the status machine against real data', async () => {
      const e = await makeExam();
      await rejectsWith(exams.changeStatus(e.id, 'registration_open'), 409, 'NO_SLOTS');
      const c = await makeCenter(20);
      await slots.create(e.id, await slotInput(c.id, { capacity: 10 }));
      assert.equal((await exams.changeStatus(e.id, 'registration_open')).status, 'registration_open');
      assert.equal((await exams.changeStatus(e.id, 'registration_closed')).status, 'registration_closed');
      assert.equal((await exams.changeStatus(e.id, 'scheduled')).status, 'scheduled');
      await rejectsWith(exams.changeStatus(e.id, 'completed'), 409, 'SLOTS_NOT_FINISHED'); // the slot is 60 days away
      await rejectsWith(exams.update(e.id, { exam_name: 'Too late now' }), 409, 'EXAM_LOCKED');
    });

    it('locks duration and fee once someone has registered, and lets registration be extended past a slot date', async () => {
      const e = await makeExam();
      const c = await makeCenter(20);
      const s = await slots.create(e.id, await slotInput(c.id, { capacity: 10 })); // 60 days ahead
      const later = await when(90);
      assert.equal((await exams.update(e.id, { registration_end_date: later })).registration_end_date, later); // later than the slot: allowed
      await rejectsWith(exams.update(e.id, { exam_duration_minutes: 240 }), 409, 'SLOT_TOO_SHORT');
      await bookCandidate(e.id, c.id, s.id);
      await rejectsWith(exams.update(e.id, { exam_duration_minutes: 120 }), 409, 'HAS_REGISTRATIONS');
      assert.equal((await exams.get(e.id)).registration_count, 1);
    });
  });

  describe('centers and computers', () => {
    it('bulk-creates numbered PCs and keeps the counter columns in step with the computers table', async () => {
      const c = await makeCenter(0);
      const first = await centers.bulkCreateComputers(c.id, { count: 60 });
      assert.deepEqual([first.first_label, first.last_label], ['PC-001', 'PC-060']);
      let [row] = await sql('SELECT max_capacity, available_computers FROM exam_centers WHERE id = ?', [c.id]);
      assert.deepEqual([row.max_capacity, row.available_computers], [60, 60]);

      const more = await centers.bulkCreateComputers(c.id, { count: 5 });
      assert.deepEqual([more.first_label, more.last_label], ['PC-061', 'PC-065']);

      const pc = (await centers.listComputers(c.id, { page: 1, limit: 1 })).computers[0];
      const out = await centers.setComputerStatus(c.id, pc.id, 'maintenance');
      assert.deepEqual([out.center.total_computers, out.center.working_computers], [65, 64]);
      [row] = await sql('SELECT max_capacity, available_computers FROM exam_centers WHERE id = ?', [c.id]);
      assert.deepEqual([row.max_capacity, row.available_computers], [65, 64]);
    });

    it('is all-or-nothing on a label clash, including a clash that differs only by letter case', async () => {
      const c = await makeCenter(10);
      await rejectsWith(centers.bulkCreateComputers(c.id, { count: 5, start_number: 8 }), 409, 'PC_LABEL_EXISTS');
      await rejectsWith(centers.bulkCreateComputers(c.id, { count: 2, prefix: 'pc-', start_number: 1 }), 409, 'PC_LABEL_EXISTS');
      assert.equal((await sql('SELECT COUNT(*) AS n FROM computers WHERE center_id = ?', [c.id]))[0].n, 10);
    });

    it('two simultaneous bulk requests never produce duplicate labels', async () => {
      const c = await makeCenter(0);
      const results = await Promise.all([
        centers.bulkCreateComputers(c.id, { count: 10 }),
        centers.bulkCreateComputers(c.id, { count: 10 }),
      ]);
      assert.equal(results.length, 2);
      const labels = (await sql('SELECT pc_label FROM computers WHERE center_id = ?', [c.id])).map((r) => r.pc_label);
      assert.equal(labels.length, 20);
      assert.equal(new Set(labels).size, 20);
    });

    it('refuses to delete or deactivate a center that has slots or bookings', async () => {
      const e = await makeExam();
      const c = await makeCenter(10);
      const s = await slots.create(e.id, await slotInput(c.id, { capacity: 5 }));
      await rejectsWith(centers.remove(c.id), 409, 'CENTER_IN_USE');
      await bookCandidate(e.id, c.id, s.id);
      await rejectsWith(centers.update(c.id, { is_active: false }), 409, 'CENTER_HAS_BOOKINGS');
      const unused = await makeCenter(3);
      await centers.remove(unused.id);
      assert.equal((await sql('SELECT COUNT(*) AS n FROM computers WHERE center_id = ?', [unused.id]))[0].n, 0);
    });

    it('lists, filters and paginates centers', async () => {
      await makeCenter(0, { center_name: 'Centre A', city: 'Guntur' });
      const b = await makeCenter(0, { center_name: 'Centre B', city: 'Vijayawada' });
      await centers.update(b.id, { is_active: false });
      assert.equal((await centers.list({ page: 1, limit: 1 })).centers.length, 1);
      assert.equal((await centers.list({ page: 1, limit: 20, city: 'Guntur' })).total, 1);
      assert.equal((await centers.list({ page: 1, limit: 20, is_active: false })).total, 1);
      assert.equal((await centers.get(b.id)).center.is_active, false);
    });
  });

  describe('slots', () => {
    it('creates, lists and checks capacity against the working PCs and overlapping slots', async () => {
      const e1 = await makeExam({ exam_name: 'Exam one' });
      const e2 = await makeExam({ exam_name: 'Exam two' });
      const c = await makeCenter(60);

      const a = await slots.create(e1.id, await slotInput(c.id, { capacity: 40 }));
      assert.deepEqual([a.seats_left, a.booked_count, a.slot_start_time], [40, 0, '09:00:00']);

      await assert.rejects(slots.create(e2.id, await slotInput(c.id, { slot_start_time: '11:00:00', slot_end_time: '14:30:00', capacity: 30 })), (err) => {
        assert.equal(err.extra.code, 'CAPACITY_EXCEEDED');
        assert.deepEqual(err.extra.details, { working_computers: 60, overlapping_capacity: 40, requested: 30, available: 20 });
        return true;
      });
      await slots.create(e2.id, await slotInput(c.id, { slot_start_time: '11:00:00', slot_end_time: '14:30:00', capacity: 20 }));
      await slots.create(e1.id, await slotInput(c.id, { slot_start_time: '14:30:00', slot_end_time: '18:00:00', capacity: 60 })); // starts when the other ends
      await rejectsWith(slots.create(e1.id, await slotInput(c.id, { capacity: 1 })), 409, 'SLOT_EXISTS');

      const listed = (await slots.list(e1.id, {})).slots;
      assert.equal(listed.length, 2);
      assert.equal(listed[0].center_name, c.center_name);
    });

    it('PCs in maintenance are not counted', async () => {
      const e = await makeExam();
      const c = await makeCenter(60);
      const pcs = (await centers.listComputers(c.id, { page: 1, limit: 200 })).computers;
      for (const pc of pcs.slice(0, 10)) await centers.setComputerStatus(c.id, pc.id, 'maintenance');
      await rejectsWith(slots.create(e.id, await slotInput(c.id, { capacity: 51 })), 409, 'CAPACITY_EXCEEDED');
      await slots.create(e.id, await slotInput(c.id, { capacity: 50 }));
      const pc = pcs[20];
      await rejectsWith(centers.setComputerStatus(c.id, pc.id, 'maintenance'), 409, 'CAPACITY_BELOW_DEMAND');
    });

    it('enforces the time rules (in the past, too short)', async () => {
      const e = await makeExam();
      const c = await makeCenter(20);
      await rejectsWith(slots.create(e.id, await slotInput(c.id, { exam_date: (await when(-2)).slice(0, 10) })), 422, 'SLOT_IN_PAST');
      await rejectsWith(slots.create(e.id, await slotInput(c.id, { slot_end_time: '10:00:00' })), 422, 'SLOT_TOO_SHORT');
    });

    it('lets an admin create a future slot while registration is still open', async () => {
      const e = await makeExam(); // registration closes 30 days from now
      const c = await makeCenter(30);
      await slots.create(e.id, await slotInput(c.id, { capacity: 10 })); // 60 days ahead
      assert.equal((await exams.changeStatus(e.id, 'registration_open')).status, 'registration_open');

      const early = await slots.create(e.id, await slotInput(c.id, { exam_date: (await when(10)).slice(0, 10), capacity: 10 })); // before registration closes
      assert.equal(early.capacity, 10);
      assert.equal((await exams.get(e.id)).examination.status, 'registration_open');
      assert.equal((await exams.get(e.id)).slots_summary.count, 2);
    });

    it('simultaneous slot requests from different exams can never overbook a center', async () => {
      const e1 = await makeExam({ exam_name: 'Exam one' });
      const e2 = await makeExam({ exam_name: 'Exam two' });
      const c = await makeCenter(60);
      const day = await slotDay();
      const attempt = (exam, start) =>
        slots.create(exam.id, { center_id: c.id, exam_date: day, slot_start_time: start, slot_end_time: `${String(Number(start.slice(0, 2)) + 4).padStart(2, '0')}${start.slice(2)}`, capacity: 20 })
          .then(() => 'ok', (err) => err.extra && err.extra.code);

      // six overlapping 4-hour slots of 20 seats each; only three can fit on 60 PCs
      const outcomes = await Promise.all([
        attempt(e1, '08:00:00'), attempt(e2, '08:10:00'), attempt(e1, '08:20:00'),
        attempt(e2, '08:30:00'), attempt(e1, '08:40:00'), attempt(e2, '08:50:00'),
      ]);
      assert.equal(outcomes.filter((o) => o === 'ok').length, 3, JSON.stringify(outcomes));
      assert.equal(outcomes.filter((o) => o === 'CAPACITY_EXCEEDED').length, 3, JSON.stringify(outcomes));
      const [{ total }] = await sql('SELECT SUM(capacity) AS total FROM exam_slots WHERE center_id = ?', [c.id]);
      assert.equal(Number(total), 60);
    });

    it('counts booked seats, ignores cancelled registrations for seats but still blocks deletion', async () => {
      const e = await makeExam();
      const c = await makeCenter(60);
      const s = await slots.create(e.id, await slotInput(c.id, { capacity: 10 }));
      await bookCandidate(e.id, c.id, s.id, 1, 'completed');
      await bookCandidate(e.id, c.id, s.id, 2, 'pending_payment');
      const cancelled = await bookCandidate(e.id, c.id, s.id, 3, 'cancelled');
      assert.ok(cancelled);

      const [listed] = (await slots.list(e.id, {})).slots;
      assert.deepEqual([listed.booked_count, listed.seats_left], [2, 8]);

      await rejectsWith(slots.updateCapacity(s.id, { capacity: 1 }), 409, 'CAPACITY_BELOW_BOOKED');
      assert.equal((await slots.updateCapacity(s.id, { capacity: 2 })).capacity, 2);
      await rejectsWith(slots.remove(s.id), 409, 'SLOT_IN_USE');
    });

    it('deletes an unused slot but never the last slot of an open exam', async () => {
      const e = await makeExam();
      const c = await makeCenter(30);
      const s1 = await slots.create(e.id, await slotInput(c.id, { capacity: 5 }));
      const s2 = await slots.create(e.id, await slotInput(c.id, { slot_start_time: '14:30:00', slot_end_time: '18:00:00', capacity: 5 }));
      await exams.changeStatus(e.id, 'registration_open');
      await slots.remove(s1.id);
      await rejectsWith(slots.remove(s2.id), 409, 'LAST_SLOT');
      await rejectsWith(slots.remove(999999), 404);
    });
  });
});
