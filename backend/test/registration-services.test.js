// Phase 3C business rules, tested against the REAL services with in-memory fakes for the models
// (no MySQL, no HTTP). True concurrency and row locking cannot be simulated here: see test/db/registration.db.test.js.
const h = require('./support/harness'); // first: sets NODE_ENV=test and installs the fakes
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const exams = require('../src/services/examinationService');
const centers = require('../src/services/centerService');
const slots = require('../src/services/slotService');
const catalog = require('../src/services/catalogService');
const registrations = require('../src/services/registrationService');

// "Now" in the fake clock is 2026-10-06 10:00:00.
async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, `expected HTTP ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.extra && err.extra.code, code, `expected ${code}, got ${err.extra && err.extra.code}: ${err.message}`);
    return true;
  });
}

let seq = 0;
async function openExam({ fee = '0.00', capacity = 5, pcs = 10, regStart = '2026-10-01 09:00:00', regEnd = '2026-10-31 23:59:59', day = '2026-12-14', start = '09:00:00', end = '12:30:00', name = 'ExamPro CBT 2026', open = true } = {}) {
  const exam = await exams.create({ exam_name: name, registration_start_date: regStart, registration_end_date: regEnd, exam_duration_minutes: 180, fee });
  const center = await centers.create({ center_name: `Centre ${++seq}`, city: 'Vijayawada', state: 'Andhra Pradesh', address: 'MG Road' });
  await centers.bulkCreateComputers(center.id, { count: pcs });
  const slot = await slots.create(exam.id, { center_id: center.id, exam_date: day, slot_start_time: start, slot_end_time: end, capacity });
  if (open) await exams.changeStatus(exam.id, 'registration_open');
  return { exam, center, slot };
}
const student = (n) => h.seedStudent({ email: `student${n}@example.com`, password: 'Stud1234x', fullName: `Student ${n}` });
const examRow = (id) => h.db.examinations.find((e) => e.id === id);

beforeEach(() => h.resetDb());

describe('exam discovery', () => {
  it('shows open, closed and scheduled exams, hides draft and completed ones, open first', async () => {
    const open = await openExam({ name: 'Open exam' });
    const closed = await openExam({ name: 'Closed exam' });
    await exams.changeStatus(closed.exam.id, 'registration_closed');
    const scheduled = await openExam({ name: 'Scheduled exam' });
    await exams.changeStatus(scheduled.exam.id, 'registration_closed');
    await exams.changeStatus(scheduled.exam.id, 'scheduled');
    await openExam({ name: 'Draft exam', open: false });
    const done = await openExam({ name: 'Completed exam' });
    examRow(done.exam.id).status = 'completed';

    const { examinations, total } = await catalog.listExams({ page: 1, limit: 20 });
    assert.equal(total, 3);
    // Open exams first; then by registration end date, and newest first when the dates are equal (as here).
    assert.deepEqual(examinations.map((e) => e.exam_name), ['Open exam', 'Scheduled exam', 'Closed exam']);
    assert.equal(examinations[0].id, open.exam.id);
    assert.deepEqual([examinations[0].registration_state, examinations[0].can_register], ['open', true]);
    assert.deepEqual([examinations[1].registration_state, examinations[1].can_register], ['closed', false]);
  });

  it('exposes only student-safe fields', async () => {
    await openExam();
    const [e] = (await catalog.listExams({ page: 1, limit: 20 })).examinations;
    assert.deepEqual(Object.keys(e).sort(), [
      'can_register', 'description', 'exam_duration_minutes', 'exam_name', 'fee', 'id', 'registration_end_date',
      'registration_start_date', 'registration_state', 'status', 'timezone',
    ]);
  });

  it('paginates and searches', async () => {
    await openExam({ name: 'Alpha test' });
    await openExam({ name: 'Bravo test' });
    await openExam({ name: 'Charlie quiz' });
    const page = await catalog.listExams({ page: 2, limit: 2 });
    assert.deepEqual([page.total, page.examinations.length, page.page, page.limit], [3, 1, 2, 2]);
    assert.equal((await catalog.listExams({ page: 1, limit: 20, q: 'test' })).total, 2);
    assert.equal((await catalog.listExams({ page: 1, limit: 20, q: 'zzz' })).total, 0);
  });

  it('reports upcoming and closed registration windows from the clock', async () => {
    await openExam({ name: 'Later', regStart: '2026-11-01 09:00:00', regEnd: '2026-11-30 23:59:59' });
    const [e] = (await catalog.listExams({ page: 1, limit: 20 })).examinations;
    assert.deepEqual([e.registration_state, e.can_register], ['upcoming', false]);
    h.advance(30 * 24 * 3600); // 2026-11-05: inside the window
    assert.equal((await catalog.listExams({ page: 1, limit: 20 })).examinations[0].can_register, true);
    h.advance(30 * 24 * 3600); // 2026-12-05: window over
    assert.equal((await catalog.listExams({ page: 1, limit: 20 })).examinations[0].registration_state, 'closed');
  });

  it('gives details, with instructions and the student\'s own registration', async () => {
    const { exam, slot } = await openExam();
    examRow(exam.id).instructions = 'Carry your hall ticket.';
    const s = await student(1);
    const before = (await catalog.getExam(s, exam.id)).examination;
    assert.equal(before.instructions, 'Carry your hall ticket.');
    assert.equal(before.my_registration, null);
    const reg = await registrations.register(s, slot.id);
    const after = (await catalog.getExam(s, exam.id)).examination;
    assert.deepEqual(after.my_registration, { id: reg.id, registration_id: reg.registration_id, status: 'completed' });
    const other = await student(2);
    assert.equal((await catalog.getExam(other, exam.id)).examination.my_registration, null);
  });

  it('returns 404 for draft, completed and unknown exams', async () => {
    const draft = await openExam({ open: false });
    const done = await openExam();
    examRow(done.exam.id).status = 'completed';
    const s = await student(1);
    await rejectsWith(catalog.getExam(s, draft.exam.id), 404);
    await rejectsWith(catalog.getExam(s, done.exam.id), 404);
    await rejectsWith(catalog.getExam(s, 9999), 404);
    await rejectsWith(catalog.listSlots(draft.exam.id, {}), 404);
  });
});

describe('slot discovery', () => {
  it('lists future slots with seats left, filters by center and date, and hides inactive centers', async () => {
    const a = await openExam({ capacity: 5 });
    const second = await centers.create({ center_name: 'Second Centre', city: 'Guntur', state: 'Andhra Pradesh' });
    await centers.bulkCreateComputers(second.id, { count: 10 });
    await slots.create(a.exam.id, { center_id: second.id, exam_date: '2026-12-15', slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 4 });

    const all = (await catalog.listSlots(a.exam.id, {})).slots;
    assert.equal(all.length, 2);
    assert.deepEqual(Object.keys(all[0]).sort(), [
      'address', 'booked_count', 'capacity', 'center_id', 'center_name', 'city', 'exam_date', 'examination_id', 'id',
      'is_full', 'seats_left', 'slot_end_time', 'slot_start_time', 'state', 'timezone',
    ]);
    assert.equal((await catalog.listSlots(a.exam.id, { center_id: second.id })).slots.length, 1);
    assert.equal((await catalog.listSlots(a.exam.id, { date: '2026-12-15' })).slots.length, 1);
    assert.equal((await catalog.listSlots(a.exam.id, { date: '2027-01-01' })).slots.length, 0);

    await centers.update(second.id, { is_active: false });
    assert.equal((await catalog.listSlots(a.exam.id, {})).slots.length, 1, 'slots at a deactivated center are hidden');
  });

  it('counts booked seats, ignores cancelled registrations, and flags a full slot', async () => {
    const { exam, slot } = await openExam({ capacity: 2 });
    const s1 = await student(1);
    const s2 = await student(2);
    const r1 = await registrations.register(s1, slot.id);
    await registrations.register(s2, slot.id);
    let [row] = (await catalog.listSlots(exam.id, {})).slots;
    assert.deepEqual([row.booked_count, row.seats_left, row.is_full], [2, 0, true]);

    await registrations.cancel(s1, r1.id);
    [row] = (await catalog.listSlots(exam.id, {})).slots;
    assert.deepEqual([row.booked_count, row.seats_left, row.is_full], [1, 1, false]);
  });

  it('shows the seats a center really has: PCs in maintenance are never counted', async () => {
    const e = await exams.create({ exam_name: 'PC check', registration_start_date: '2026-10-01 09:00:00', registration_end_date: '2026-10-31 23:59:59', exam_duration_minutes: 180, fee: '0.00' });
    const c = await centers.create({ center_name: 'Small centre', city: 'Vijayawada', state: 'Andhra Pradesh' });
    await centers.bulkCreateComputers(c.id, { count: 10 });
    for (const pc of h.db.computers.slice(0, 3)) await centers.setComputerStatus(c.id, pc.id, 'maintenance');
    await rejectsWith(slots.create(e.id, { center_id: c.id, exam_date: '2026-12-14', slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 8 }), 409, 'CAPACITY_EXCEEDED');
    await slots.create(e.id, { center_id: c.id, exam_date: '2026-12-14', slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 7 });
    await exams.changeStatus(e.id, 'registration_open');
    assert.equal((await catalog.listSlots(e.id, {})).slots[0].seats_left, 7);
  });

  it('hides a slot once it has started', async () => {
    const { exam } = await openExam({ day: '2026-10-06', start: '11:00:00', end: '14:30:00' });
    assert.equal((await catalog.listSlots(exam.id, {})).slots.length, 1);
    h.advance(2 * 3600); // 12:00: the slot started at 11:00
    assert.equal((await catalog.listSlots(exam.id, {})).slots.length, 0);
  });

  it('says whether the student can register right now', async () => {
    const { exam } = await openExam();
    assert.deepEqual((await catalog.listSlots(exam.id, {})).examination, { id: exam.id, exam_name: exam.exam_name, registration_state: 'open', can_register: true });
  });
});

describe('registering', () => {
  it('registers a student: codes, status, allocation and seat count', async () => {
    const { exam, center, slot } = await openExam({ capacity: 5 });
    const s = await student(1);
    const r = await registrations.register(s, slot.id);

    assert.match(r.registration_id, /^EXP2026\d{6}$/);
    assert.match(r.application_id, /^APP2026\d{6}$/);
    assert.equal(r.status, 'completed'); // fee 0.00
    assert.equal(r.can_cancel, true);
    assert.deepEqual([r.examination.id, r.center.id, r.slot.id], [exam.id, center.id, slot.id]);
    assert.deepEqual([r.slot.exam_date, r.slot.slot_start_time], ['2026-12-14', '09:00:00']);
    assert.equal(h.db.allocations.length, 1);
    assert.equal(h.db.allocations[0].exam_center_id, center.id, 'the center comes from the slot, not the client');
    assert.equal(h.db.registrations[0].student_id, s);
  });

  it('a paid exam starts as pending_payment and still holds the seat', async () => {
    const { exam, slot } = await openExam({ fee: '500.00', capacity: 1 });
    const r = await registrations.register(await student(1), slot.id);
    assert.equal(r.status, 'pending_payment');
    assert.equal(r.examination.fee, '500.00');
    assert.equal((await catalog.listSlots(exam.id, {})).slots[0].seats_left, 0);
    await rejectsWith(registrations.register(await student(2), slot.id), 409, 'SLOT_FULL');
  });

  it('refuses a second active registration for the same exam, even in another slot', async () => {
    const { exam, center, slot } = await openExam({ capacity: 5 });
    const second = await slots.create(exam.id, { center_id: center.id, exam_date: '2026-12-15', slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 5 });
    const s = await student(1);
    const first = await registrations.register(s, slot.id);
    await assert.rejects(registrations.register(s, slot.id), (err) => err.status === 409 && err.extra.code === 'DUPLICATE_REGISTRATION' && err.extra.details.registration_id === first.registration_id);
    await rejectsWith(registrations.register(s, second.id), 409, 'DUPLICATE_REGISTRATION');
    assert.equal(h.db.registrations.length, 1);
  });

  it('the database backstop (unique key) is also reported as DUPLICATE_REGISTRATION', async () => {
    const { slot } = await openExam();
    const s = await student(1);
    await registrations.register(s, slot.id);
    const model = require('../src/models/registrationModel');
    const original = model.findActiveForStudentExam;
    model.findActiveForStudentExam = async () => null; // pretend the application-level check was skipped
    try {
      await rejectsWith(registrations.register(s, slot.id), 409, 'DUPLICATE_REGISTRATION');
    } finally {
      model.findActiveForStudentExam = original;
    }
  });

  it('refuses a full slot', async () => {
    const { slot } = await openExam({ capacity: 2 });
    await registrations.register(await student(1), slot.id);
    await registrations.register(await student(2), slot.id);
    await rejectsWith(registrations.register(await student(3), slot.id), 409, 'SLOT_FULL');
    assert.equal(h.db.registrations.length, 2);
  });

  it('refuses a slot that has already started', async () => {
    const { slot } = await openExam({ day: '2026-10-06', start: '11:00:00', end: '14:30:00' });
    const s = await student(1);
    assert.ok(await registrations.register(s, slot.id));
    h.resetDb();
    const again = await openExam({ day: '2026-10-06', start: '11:00:00', end: '14:30:00' });
    h.advance(2 * 3600);
    await rejectsWith(registrations.register(await student(1), again.slot.id), 409, 'SLOT_STARTED');
  });

  it('enforces the registration window: start inclusive, end exclusive', async () => {
    const notYet = await openExam({ regStart: '2026-10-20 09:00:00', regEnd: '2026-11-30 23:59:59' });
    await rejectsWith(registrations.register(await student(1), notYet.slot.id), 409, 'REGISTRATION_NOT_STARTED');

    h.resetDb();
    const startsNow = await openExam({ regStart: '2026-10-06 10:00:00' });
    assert.ok(await registrations.register(await student(1), startsNow.slot.id), 'allowed exactly at the start');

    h.resetDb();
    const ended = await openExam();
    examRow(ended.exam.id).registration_end_date = '2026-10-06 10:00:00'; // ends exactly now
    await rejectsWith(registrations.register(await student(1), ended.slot.id), 409, 'REGISTRATION_CLOSED');
  });

  it('refuses when the exam is not open, and hides draft or completed exams', async () => {
    const closed = await openExam();
    await exams.changeStatus(closed.exam.id, 'registration_closed');
    await rejectsWith(registrations.register(await student(1), closed.slot.id), 409, 'REGISTRATION_NOT_OPEN');

    const draft = await openExam({ open: false });
    await rejectsWith(registrations.register(await student(1), draft.slot.id), 404, 'SLOT_NOT_FOUND');
    const done = await openExam();
    examRow(done.exam.id).status = 'completed';
    await rejectsWith(registrations.register(await student(1), done.slot.id), 404, 'SLOT_NOT_FOUND');
  });

  it('refuses an unknown slot and an inactive center', async () => {
    await rejectsWith(registrations.register(await student(1), 99999), 404, 'SLOT_NOT_FOUND');
    const { center, slot } = await openExam();
    await centers.update(center.id, { is_active: false });
    await rejectsWith(registrations.register(await student(1), slot.id), 409, 'CENTER_INACTIVE');
  });

  it('refuses an unverified or unknown student account', async () => {
    const { slot } = await openExam();
    const unverified = await h.seedStudent({ email: 'new@example.com', password: 'Stud1234x', verified: false });
    await rejectsWith(registrations.register(unverified, slot.id), 403, 'ACCOUNT_NOT_ELIGIBLE');
    await rejectsWith(registrations.register(99999, slot.id), 403, 'ACCOUNT_NOT_ELIGIBLE');
  });

  it('gives every registration its own codes', async () => {
    const { slot } = await openExam({ capacity: 10 });
    const out = [];
    for (let n = 1; n <= 5; n += 1) out.push(await registrations.register(await student(n), slot.id));
    assert.equal(new Set(out.map((r) => r.registration_id)).size, 5);
    assert.equal(new Set(out.map((r) => r.application_id)).size, 5);
  });
});

describe('my registrations', () => {
  it('returns only the student\'s own registrations, newest first, with pagination', async () => {
    const a = await openExam({ name: 'Exam A', capacity: 5 });
    const b = await openExam({ name: 'Exam B', capacity: 5 });
    const s1 = await student(1);
    const s2 = await student(2);
    await registrations.register(s1, a.slot.id);
    await registrations.register(s1, b.slot.id);
    await registrations.register(s2, a.slot.id);

    const mine = await registrations.listMine(s1, { page: 1, limit: 20 });
    assert.equal(mine.total, 2);
    assert.deepEqual(mine.registrations.map((r) => r.examination.exam_name), ['Exam B', 'Exam A']);
    assert.equal((await registrations.listMine(s2, { page: 1, limit: 20 })).total, 1);

    const page2 = await registrations.listMine(s1, { page: 2, limit: 1 });
    assert.deepEqual([page2.registrations.length, page2.total, page2.registrations[0].examination.exam_name], [1, 2, 'Exam A']);
    assert.equal((await registrations.listMine(await student(3), { page: 1, limit: 20 })).total, 0);
  });

  it('includes exam, center, slot and times; a cancelled entry keeps history but no seat', async () => {
    const { center, slot } = await openExam();
    const s = await student(1);
    const r = await registrations.register(s, slot.id);
    const [live] = (await registrations.listMine(s, { page: 1, limit: 20 })).registrations;
    assert.deepEqual([live.center.center_name, live.center.city, live.center.address], [center.center_name, 'Vijayawada', 'MG Road']);
    assert.deepEqual([live.slot.exam_date, live.slot.slot_start_time, live.slot.slot_end_time], ['2026-12-14', '09:00:00', '12:30:00']);
    assert.ok(live.registered_at);

    await registrations.cancel(s, r.id);
    const [gone] = (await registrations.listMine(s, { page: 1, limit: 20 })).registrations;
    assert.deepEqual([gone.status, gone.center, gone.slot, gone.can_cancel], ['cancelled', null, null, false]);
  });
});

describe('cancelling', () => {
  it('cancels, frees the seat, and lets someone else take it', async () => {
    const { slot } = await openExam({ capacity: 1 });
    const s1 = await student(1);
    const s2 = await student(2);
    const r1 = await registrations.register(s1, slot.id);
    await rejectsWith(registrations.register(s2, slot.id), 409, 'SLOT_FULL');

    const out = await registrations.cancel(s1, r1.id);
    assert.deepEqual([out.status, out.can_cancel], ['cancelled', false]);
    assert.equal(h.db.allocations.length, 0);
    assert.ok(await registrations.register(s2, slot.id));
  });

  it('refuses to cancel twice', async () => {
    const { slot } = await openExam();
    const s = await student(1);
    const r = await registrations.register(s, slot.id);
    await registrations.cancel(s, r.id);
    await rejectsWith(registrations.cancel(s, r.id), 409, 'ALREADY_CANCELLED');
  });

  it('treats another student\'s registration, and a missing one, as not found', async () => {
    const { slot } = await openExam();
    const owner = await student(1);
    const intruder = await student(2);
    const r = await registrations.register(owner, slot.id);
    await rejectsWith(registrations.cancel(intruder, r.id), 404, 'REGISTRATION_NOT_FOUND');
    await rejectsWith(registrations.cancel(owner, 99999), 404, 'REGISTRATION_NOT_FOUND');
    assert.equal(h.db.registrations[0].status, 'completed', 'the owner\'s registration is untouched');
  });

  it('refuses after registration ends, once the exam is no longer open, or once the slot has started', async () => {
    const a = await openExam();
    const sa = await student(1);
    const ra = await registrations.register(sa, a.slot.id);
    examRow(a.exam.id).registration_end_date = '2026-10-06 10:00:00';
    await rejectsWith(registrations.cancel(sa, ra.id), 409, 'CANCELLATION_CLOSED');

    h.resetDb();
    const b = await openExam();
    const sb = await student(1);
    const rb = await registrations.register(sb, b.slot.id);
    await exams.changeStatus(b.exam.id, 'registration_closed');
    await rejectsWith(registrations.cancel(sb, rb.id), 409, 'CANCELLATION_CLOSED');

    h.resetDb();
    const c = await openExam({ day: '2026-10-06', start: '11:00:00', end: '14:30:00' });
    const sc = await student(1);
    const rc = await registrations.register(sc, c.slot.id);
    h.advance(2 * 3600);
    await rejectsWith(registrations.cancel(sc, rc.id), 409, 'CANCELLATION_CLOSED');
  });

  it('refuses when a payment has been received', async () => {
    const { slot } = await openExam({ fee: '500.00' });
    const s = await student(1);
    const r = await registrations.register(s, slot.id);
    h.db.payments.push({ registration_id: r.id, status: 'successful' });
    await rejectsWith(registrations.cancel(s, r.id), 409, 'PAYMENT_RECEIVED');
    assert.equal((await registrations.listMine(s, { page: 1, limit: 5 })).registrations[0].can_cancel, false);
  });

  it('allows registering again after cancelling, with a fresh registration', async () => {
    const { slot } = await openExam();
    const s = await student(1);
    const first = await registrations.register(s, slot.id);
    await registrations.cancel(s, first.id);
    const second = await registrations.register(s, slot.id);
    assert.notEqual(second.id, first.id);
    assert.notEqual(second.registration_id, first.registration_id);
    assert.deepEqual(h.db.registrations.map((r) => r.status), ['cancelled', 'completed']);
    await rejectsWith(registrations.register(s, slot.id), 409, 'DUPLICATE_REGISTRATION');
  });

  it('cancelled registrations never consume seats', async () => {
    const { slot } = await openExam({ capacity: 1 });
    for (let n = 1; n <= 3; n += 1) {
      const s = await student(n);
      const r = await registrations.register(s, slot.id);
      await registrations.cancel(s, r.id);
    }
    assert.ok(await registrations.register(await student(9), slot.id));
  });
});
