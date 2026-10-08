// Phase 3B business rules, tested against the REAL services with in-memory fakes for the models
// (no MySQL, no HTTP). Covers the status machine, PC management, slot capacity and every guard.
const h = require('./support/harness'); // first: sets NODE_ENV=test and installs the fakes
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const exams = require('../src/services/examinationService');
const centers = require('../src/services/centerService');
const slots = require('../src/services/slotService');

// "Now" in the fake clock is 2026-10-06 10:00:00.
const EXAM = {
  exam_name: 'ExamPro CBT 2026',
  registration_start_date: '2026-10-01 09:00:00',
  registration_end_date: '2026-10-31 23:59:59',
  exam_duration_minutes: 180,
  fee: '500.00',
};
const DAY = '2026-12-14';

async function rejectsWith(promise, status, code) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.status, status, `expected HTTP ${status}, got ${err.status}: ${err.message}`);
    if (code) assert.equal(err.extra && err.extra.code, code, `expected code ${code}, got ${err.extra && err.extra.code}: ${err.message}`);
    return true;
  });
}

const makeExam = (over = {}) => exams.create({ ...EXAM, ...over });
const makeCenter = (over = {}) => centers.create({ center_name: 'ExamPro Centre - Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', ...over });
async function centerWithPcs(count = 60) {
  const c = await makeCenter();
  await centers.bulkCreateComputers(c.id, { count });
  return c;
}
const slotInput = (centerId, over = {}) => ({ center_id: centerId, exam_date: DAY, slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity: 40, ...over });

beforeEach(() => h.resetDb());

describe('examinations', () => {
  it('creates a draft exam with a default fee and the business time zone', async () => {
    const e = await makeExam({ fee: undefined });
    assert.equal(e.status, 'draft');
    assert.equal(e.fee, '0.00');
    assert.equal(e.timezone, h.config.db.timeZone);
    assert.equal(e.description, null);
  });

  it('rejects a registration window that closes before it opens', async () => {
    await rejectsWith(makeExam({ registration_end_date: '2026-09-01 00:00:00' }), 422, 'INVALID_WINDOW');
  });

  it('lists with pagination and filters, and gets one with a summary', async () => {
    await makeExam({ exam_name: 'Alpha exam' });
    const b = await makeExam({ exam_name: 'Bravo exam' });
    const all = await exams.list({ page: 1, limit: 1 });
    assert.equal(all.total, 2);
    assert.equal(all.examinations.length, 1);
    assert.equal(all.examinations[0].id, b.id, 'newest first');
    assert.equal((await exams.list({ page: 1, limit: 20, q: 'alpha' })).total, 1);
    assert.equal((await exams.list({ page: 1, limit: 20, status: 'scheduled' })).total, 0);
    const one = await exams.get(b.id);
    assert.deepEqual(one.slots_summary, { count: 0, total_capacity: 0 });
    await rejectsWith(exams.get(999), 404);
  });

  it('edits freely while draft, but not once scheduled', async () => {
    const e = await makeExam();
    const edited = await exams.update(e.id, { exam_name: 'Renamed exam', description: null });
    assert.equal(edited.exam_name, 'Renamed exam');
    h.db.examinations[0].status = 'scheduled';
    await rejectsWith(exams.update(e.id, { exam_name: 'Nope nope' }), 409, 'EXAM_LOCKED');
  });

  it('locks duration and fee once candidates have registered', async () => {
    const e = await makeExam();
    h.db.registrations.push({ id: 1, examination_id: e.id, status: 'completed' });
    await rejectsWith(exams.update(e.id, { exam_duration_minutes: 120 }), 409, 'HAS_REGISTRATIONS');
    await rejectsWith(exams.update(e.id, { fee: '100.00' }), 409, 'HAS_REGISTRATIONS');
    assert.equal((await exams.update(e.id, { exam_name: 'Still editable' })).exam_name, 'Still editable');
    assert.equal((await exams.update(e.id, { fee: '500.00' })).fee, '500.00', 'an unchanged fee is fine');
  });

  it('lets registration be extended past a slot date, and keeps slots at least as long as the exam', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await slots.create(e.id, slotInput(c.id)); // 2026-12-14 09:00, 210 minutes long
    const extended = await exams.update(e.id, { registration_end_date: '2026-12-20 00:00:00' }); // later than the slot: allowed
    assert.equal(extended.registration_end_date, '2026-12-20 00:00:00');
    await rejectsWith(exams.update(e.id, { exam_duration_minutes: 240 }), 409, 'SLOT_TOO_SHORT');
    assert.equal((await exams.update(e.id, { exam_duration_minutes: 200 })).exam_duration_minutes, 200);
  });

  it('an open exam cannot be given a registration end in the past', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await slots.create(e.id, slotInput(c.id));
    await exams.changeStatus(e.id, 'registration_open');
    await rejectsWith(exams.update(e.id, { registration_end_date: '2026-10-05 00:00:00' }), 409, 'REGISTRATION_WINDOW_PAST');
  });

  describe('status machine', () => {
    it('refuses to open without slots, then opens once a slot exists', async () => {
      const e = await makeExam();
      await rejectsWith(exams.changeStatus(e.id, 'registration_open'), 409, 'NO_SLOTS');
      const c = await centerWithPcs();
      await slots.create(e.id, slotInput(c.id));
      assert.equal((await exams.changeStatus(e.id, 'registration_open')).status, 'registration_open');
    });

    it('refuses jumps and repeats', async () => {
      const e = await makeExam();
      await rejectsWith(exams.changeStatus(e.id, 'scheduled'), 409, 'INVALID_TRANSITION');
      await rejectsWith(exams.changeStatus(e.id, 'draft'), 409, 'INVALID_TRANSITION');
      await rejectsWith(exams.changeStatus(999, 'registration_open'), 404);
    });

    it('refuses to open after the registration end has passed', async () => {
      const e = await makeExam({ registration_end_date: '2026-10-06 09:00:00' }); // already past
      const c = await centerWithPcs();
      await slots.create(e.id, slotInput(c.id)); // a slot can exist even though the window already closed
      await rejectsWith(exams.changeStatus(e.id, 'registration_open'), 409, 'REGISTRATION_WINDOW_PAST');
    });

    it('refuses to open while a slot sits at a deactivated center', async () => {
      const e = await makeExam();
      const c = await centerWithPcs();
      await slots.create(e.id, slotInput(c.id));
      await centers.update(c.id, { is_active: false });
      await rejectsWith(exams.changeStatus(e.id, 'registration_open'), 409, 'INACTIVE_CENTER_SLOTS');
    });

    it('walks the full lifecycle: open -> closed -> reopened -> closed -> scheduled -> completed', async () => {
      const e = await makeExam();
      const c = await centerWithPcs();
      await slots.create(e.id, slotInput(c.id));
      for (const to of ['registration_open', 'registration_closed', 'registration_open', 'registration_closed', 'scheduled']) {
        assert.equal((await exams.changeStatus(e.id, to)).status, to);
      }
      await rejectsWith(exams.changeStatus(e.id, 'completed'), 409, 'SLOTS_NOT_FINISHED');
      h.advance(70 * 24 * 3600); // 2026-12-15: the slot has ended
      assert.equal((await exams.changeStatus(e.id, 'completed')).status, 'completed');
      await rejectsWith(exams.changeStatus(e.id, 'registration_open'), 409, 'INVALID_TRANSITION');
    });

    it('goes back to draft only while nobody has registered', async () => {
      const e = await makeExam();
      const c = await centerWithPcs();
      await slots.create(e.id, slotInput(c.id));
      await exams.changeStatus(e.id, 'registration_open');
      h.db.registrations.push({ id: 1, examination_id: e.id, status: 'pending_payment' });
      await rejectsWith(exams.changeStatus(e.id, 'draft'), 409, 'HAS_REGISTRATIONS');
      h.db.registrations[0].status = 'cancelled'; // a cancelled registration does not count
      assert.equal((await exams.changeStatus(e.id, 'draft')).status, 'draft');
    });
  });
});

describe('centers and computers', () => {
  it('creates a center with no PCs and lists/filters/gets it', async () => {
    const c = await makeCenter();
    assert.deepEqual([c.total_computers, c.working_computers, c.is_active], [0, 0, true]);
    await makeCenter({ center_name: 'Second Centre', city: 'Guntur' });
    assert.equal((await centers.list({ page: 1, limit: 20, city: 'Guntur' })).total, 1);
    assert.equal((await centers.list({ page: 1, limit: 20, is_active: false })).total, 0);
    assert.equal((await centers.get(c.id)).upcoming_slot_count, 0);
    await rejectsWith(centers.get(999), 404);
  });

  it('bulk-creates numbered PCs, keeps the counters in sync, and continues numbering', async () => {
    const c = await makeCenter();
    const first = await centers.bulkCreateComputers(c.id, { count: 60 });
    assert.deepEqual([first.created, first.first_label, first.last_label], [60, 'PC-001', 'PC-060']);
    assert.deepEqual([first.center.total_computers, first.center.working_computers], [60, 60]);
    assert.deepEqual([h.db.centers[0].max_capacity, h.db.centers[0].available_computers], [60, 60]);

    const more = await centers.bulkCreateComputers(c.id, { count: 20 });
    assert.deepEqual([more.first_label, more.last_label, more.center.total_computers], ['PC-061', 'PC-080', 80]);

    const lab = await centers.bulkCreateComputers(c.id, { count: 2, prefix: 'LAB-', start_number: 10 });
    assert.deepEqual([lab.first_label, lab.last_label], ['LAB-010', 'LAB-011']);
  });

  it('is all-or-nothing when a label already exists', async () => {
    const c = await centerWithPcs(10);
    await rejectsWith(centers.bulkCreateComputers(c.id, { count: 5, start_number: 8 }), 409, 'PC_LABEL_EXISTS');
    assert.equal(h.db.computers.length, 10, 'nothing was added');
  });

  it('enforces the per-center PC limit', async () => {
    const c = await centerWithPcs(10);
    const saved = h.config.limits.maxPcsPerCenter;
    h.config.limits.maxPcsPerCenter = 12;
    try {
      await rejectsWith(centers.bulkCreateComputers(c.id, { count: 5 }), 409, 'PC_LIMIT_EXCEEDED');
    } finally {
      h.config.limits.maxPcsPerCenter = saved;
    }
  });

  it('404s for an unknown center', async () => {
    await rejectsWith(centers.bulkCreateComputers(999, { count: 1 }), 404);
    await rejectsWith(centers.listComputers(999, { page: 1, limit: 10 }), 404);
  });

  it('lists PCs with a status filter', async () => {
    const c = await centerWithPcs(5);
    const pc = h.db.computers[0];
    await centers.setComputerStatus(c.id, pc.id, 'maintenance');
    assert.equal((await centers.listComputers(c.id, { page: 1, limit: 50 })).total, 5);
    assert.equal((await centers.listComputers(c.id, { page: 1, limit: 50, status: 'maintenance' })).total, 1);
  });

  it('takes a PC in and out of maintenance and re-syncs the counters', async () => {
    const c = await centerWithPcs(10);
    const pc = h.db.computers[0];
    const out = await centers.setComputerStatus(c.id, pc.id, 'maintenance');
    assert.deepEqual([out.center.total_computers, out.center.working_computers], [10, 9]);
    assert.equal(h.db.centers[0].available_computers, 9);
    const back = await centers.setComputerStatus(c.id, pc.id, 'available');
    assert.equal(back.center.working_computers, 10);
    await rejectsWith(centers.setComputerStatus(c.id, 9999, 'maintenance'), 404);
  });

  it('refuses to remove a PC from service if upcoming slots would no longer fit', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(40);
    await slots.create(e.id, slotInput(c.id, { capacity: 40 })); // uses every PC
    const pc = h.db.computers[0];
    await rejectsWith(centers.setComputerStatus(c.id, pc.id, 'maintenance'), 409, 'CAPACITY_BELOW_DEMAND');
    await rejectsWith(centers.deleteComputer(c.id, pc.id), 409, 'CAPACITY_BELOW_DEMAND');
    await centers.bulkCreateComputers(c.id, { count: 1 }); // a spare PC now exists
    assert.equal((await centers.setComputerStatus(c.id, pc.id, 'maintenance')).center.working_computers, 40);
  });

  it('refuses to touch a PC that has candidates assigned', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(10);
    const s = await slots.create(e.id, slotInput(c.id, { capacity: 5 }));
    const pc = h.db.computers[0];
    h.db.computerAllocations.push({ id: 1, computer_id: pc.id, exam_slot_id: s.id });
    await rejectsWith(centers.setComputerStatus(c.id, pc.id, 'maintenance'), 409, 'PC_IN_USE');
    await rejectsWith(centers.deleteComputer(c.id, pc.id), 409, 'PC_IN_USE');
  });

  it('deletes an unused PC and re-syncs', async () => {
    const c = await centerWithPcs(5);
    const out = await centers.deleteComputer(c.id, h.db.computers[4].id);
    assert.equal(out.center.total_computers, 4);
    assert.equal(h.db.centers[0].max_capacity, 4);
  });

  it('only allows deactivating a center without upcoming bookings', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    const s = await slots.create(e.id, slotInput(c.id));
    h.db.allocations.push({ id: 1, exam_slot_id: s.id, exam_center_id: c.id, registration_status: 'completed' });
    await rejectsWith(centers.update(c.id, { is_active: false }), 409, 'CENTER_HAS_BOOKINGS');
    assert.equal((await centers.update(c.id, { city: 'Amaravati' })).city, 'Amaravati');
    h.db.allocations.length = 0;
    assert.equal((await centers.update(c.id, { is_active: false })).is_active, false);
  });

  it('deletes only unused centers (a center with slots must be deactivated instead)', async () => {
    const e = await makeExam();
    const used = await centerWithPcs();
    await slots.create(e.id, slotInput(used.id));
    await rejectsWith(centers.remove(used.id), 409, 'CENTER_IN_USE');
    const unused = await centerWithPcs(3);
    await centers.remove(unused.id);
    assert.equal(h.db.centers.some((c) => c.id === unused.id), false);
    assert.equal(h.db.computers.some((p) => p.center_id === unused.id), false, 'its PCs went with it');
    await rejectsWith(centers.remove(999), 404);
  });
});

describe('slots', () => {
  it('creates a slot with the seat counts the frontend needs', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    const s = await slots.create(e.id, slotInput(c.id));
    assert.deepEqual([s.capacity, s.booked_count, s.seats_left, s.center_name, s.timezone], [40, 0, 40, c.center_name, h.config.db.timeZone]);
    assert.deepEqual([s.exam_date, s.slot_start_time, s.slot_end_time], [DAY, '09:00:00', '12:30:00']);
  });

  it('rejects a duplicate slot', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await slots.create(e.id, slotInput(c.id));
    await rejectsWith(slots.create(e.id, slotInput(c.id, { capacity: 5 })), 409, 'SLOT_EXISTS');
  });

  it('never gives a slot more seats than the working PCs', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(60);
    await rejectsWith(slots.create(e.id, slotInput(c.id, { capacity: 61 })), 409, 'CAPACITY_EXCEEDED');
    assert.equal((await slots.create(e.id, slotInput(c.id, { capacity: 60 }))).capacity, 60);
  });

  it('PCs in maintenance do not count as capacity', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(60);
    for (const pc of h.db.computers.slice(0, 10)) await centers.setComputerStatus(c.id, pc.id, 'maintenance');
    await rejectsWith(slots.create(e.id, slotInput(c.id, { capacity: 51 })), 409, 'CAPACITY_EXCEEDED');
    assert.equal((await slots.create(e.id, slotInput(c.id, { capacity: 50 }))).capacity, 50);
  });

  it('checks overlapping slots together, across different exams, with exact error details', async () => {
    const e1 = await makeExam({ exam_name: 'Exam one' });
    const e2 = await makeExam({ exam_name: 'Exam two' });
    const c = await centerWithPcs(60);
    await slots.create(e1.id, slotInput(c.id, { capacity: 40 })); // 09:00-12:30

    await assert.rejects(slots.create(e2.id, slotInput(c.id, { slot_start_time: '11:00:00', slot_end_time: '14:30:00', capacity: 30 })), (err) => {
      assert.equal(err.status, 409);
      assert.equal(err.extra.code, 'CAPACITY_EXCEEDED');
      assert.deepEqual(err.extra.details, { working_computers: 60, overlapping_capacity: 40, requested: 30, available: 20 });
      return true;
    });
    assert.equal((await slots.create(e2.id, slotInput(c.id, { slot_start_time: '11:00:00', slot_end_time: '14:30:00', capacity: 20 }))).capacity, 20);
  });

  it('allows back-to-back slots and slots at another center or on another day', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(60);
    const other = await centerWithPcs(60);
    await slots.create(e.id, slotInput(c.id, { capacity: 60 })); // 09:00-12:30
    assert.ok(await slots.create(e.id, slotInput(c.id, { slot_start_time: '12:30:00', slot_end_time: '16:00:00', capacity: 60 })));
    assert.ok(await slots.create(e.id, slotInput(other.id, { capacity: 60 })));
    assert.ok(await slots.create(e.id, slotInput(c.id, { exam_date: '2026-12-15', capacity: 60 })));
  });

  it('validates slot times and dates', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await rejectsWith(slots.create(e.id, slotInput(c.id, { slot_end_time: '09:00:00' })), 422, 'INVALID_SLOT_TIMES');
    await rejectsWith(slots.create(e.id, slotInput(c.id, { slot_end_time: '11:00:00' })), 422, 'SLOT_TOO_SHORT');
    await rejectsWith(slots.create(e.id, slotInput(c.id, { exam_date: '2026-10-05' })), 422, 'SLOT_IN_PAST');
  });

  it('lets an admin create a future slot while registration is still open', async () => {
    const e = await makeExam(); // registration closes 2026-10-31 23:59:59; "now" is 2026-10-06
    const c = await centerWithPcs();
    await slots.create(e.id, slotInput(c.id)); // an exam needs one slot before it can open
    assert.equal((await exams.changeStatus(e.id, 'registration_open')).status, 'registration_open');

    const early = await slots.create(e.id, slotInput(c.id, { exam_date: '2026-10-20', capacity: 25 })); // before registration closes
    assert.equal(early.exam_date, '2026-10-20');
    assert.equal(early.capacity, 25);
    assert.equal(h.db.examinations[0].status, 'registration_open', 'the exam stays open');
    assert.equal((await slots.list(e.id, {})).slots.length, 2);
  });

  it('lets an admin create a slot that starts before registration closes while the exam is still a draft', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    const early = await slots.create(e.id, slotInput(c.id, { exam_date: '2026-10-20' }));
    assert.equal(early.exam_date, '2026-10-20');
    assert.equal((await exams.changeStatus(e.id, 'registration_open')).status, 'registration_open');
  });

  it('still refuses a slot in the past', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await rejectsWith(slots.create(e.id, slotInput(c.id, { exam_date: '2026-10-06', slot_start_time: '09:00:00', slot_end_time: '12:30:00' })), 422, 'SLOT_IN_PAST'); // today, but before "now" (10:00)
  });

  it('rejects unknown exams and centers, deactivated centers, and locked exams', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    await rejectsWith(slots.create(999, slotInput(c.id)), 404);
    await rejectsWith(slots.create(e.id, slotInput(999)), 422, 'CENTER_NOT_FOUND');
    await centers.update(c.id, { is_active: false });
    await rejectsWith(slots.create(e.id, slotInput(c.id)), 409, 'CENTER_INACTIVE');
    await centers.update(c.id, { is_active: true });
    h.db.examinations[0].status = 'scheduled';
    await rejectsWith(slots.create(e.id, slotInput(c.id)), 409, 'EXAM_LOCKED');
  });

  it('lists slots with seats left (cancelled bookings free their seat) and filters', async () => {
    const e = await makeExam();
    const c1 = await centerWithPcs();
    const c2 = await centerWithPcs();
    const s1 = await slots.create(e.id, slotInput(c1.id, { capacity: 10 }));
    await slots.create(e.id, slotInput(c2.id, { exam_date: '2026-12-15', capacity: 10 }));
    h.db.allocations.push({ id: 1, exam_slot_id: s1.id, registration_status: 'completed' });
    h.db.allocations.push({ id: 2, exam_slot_id: s1.id, registration_status: 'pending_payment' });
    h.db.allocations.push({ id: 3, exam_slot_id: s1.id, registration_status: 'cancelled' });

    const all = (await slots.list(e.id, {})).slots;
    assert.equal(all.length, 2);
    assert.deepEqual([all[0].booked_count, all[0].seats_left], [2, 8]);
    assert.equal((await slots.list(e.id, { center_id: c2.id })).slots.length, 1);
    assert.equal((await slots.list(e.id, { date: '2026-12-15' })).slots.length, 1);
    await rejectsWith(slots.list(999, {}), 404);
  });

  it('changes capacity within the PCs, never below the booked seats, and re-checks overlaps', async () => {
    const e = await makeExam();
    const c = await centerWithPcs(60);
    const a = await slots.create(e.id, slotInput(c.id, { capacity: 20 }));
    await slots.create(e.id, slotInput(c.id, { slot_start_time: '10:00:00', slot_end_time: '13:30:00', capacity: 30 }));

    assert.equal((await slots.updateCapacity(a.id, { capacity: 30 })).capacity, 30);
    await rejectsWith(slots.updateCapacity(a.id, { capacity: 31 }), 409, 'CAPACITY_EXCEEDED'); // 31 + 30 > 60
    h.db.allocations.push({ id: 1, exam_slot_id: a.id, registration_status: 'completed' });
    h.db.allocations.push({ id: 2, exam_slot_id: a.id, registration_status: 'completed' });
    await rejectsWith(slots.updateCapacity(a.id, { capacity: 1 }), 409, 'CAPACITY_BELOW_BOOKED');
    assert.equal((await slots.updateCapacity(a.id, { capacity: 2 })).capacity, 2);
    await rejectsWith(slots.updateCapacity(9999, { capacity: 5 }), 404);
  });

  it('refuses capacity changes on finished slots and on scheduled exams', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    const s = await slots.create(e.id, slotInput(c.id));
    h.db.examinations[0].status = 'scheduled';
    await rejectsWith(slots.updateCapacity(s.id, { capacity: 10 }), 409, 'EXAM_LOCKED');
    h.db.examinations[0].status = 'draft';
    h.advance(70 * 24 * 3600);
    await rejectsWith(slots.updateCapacity(s.id, { capacity: 10 }), 409, 'SLOT_FINISHED');
  });

  it('deletes only unused slots, and never the last slot of an open exam', async () => {
    const e = await makeExam();
    const c = await centerWithPcs();
    const s1 = await slots.create(e.id, slotInput(c.id));
    const s2 = await slots.create(e.id, slotInput(c.id, { exam_date: '2026-12-15' }));

    h.db.allocations.push({ id: 1, exam_slot_id: s1.id, registration_status: 'cancelled' });
    await rejectsWith(slots.remove(s1.id), 409, 'SLOT_IN_USE'); // even a cancelled row blocks (foreign key)
    h.db.allocations.length = 0;

    await exams.changeStatus(e.id, 'registration_open');
    await slots.remove(s1.id);
    assert.equal(h.db.slots.length, 1);
    await rejectsWith(slots.remove(s2.id), 409, 'LAST_SLOT');
    await rejectsWith(slots.remove(9999), 404);
  });
});
