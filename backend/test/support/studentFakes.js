// test/support/studentFakes.js
//
// In-memory stand-ins for the Phase 3C models (catalogModel, registrationModel). They mimic what the real SQL
// returns. They CANNOT simulate row locks or true concurrency (the fakes are single-threaded), so the
// overbooking guarantees are proved by the real-database tests in test/db/registration.db.test.js.

'use strict';

function makeStudentFakes(db) {
  let nextRegistrationId = 0;
  const reset = () => { nextRegistrationId = 0; };
  const VISIBLE = new Set(['registration_open', 'registration_closed', 'scheduled']);
  const like = (value, q) => String(value).toLowerCase().includes(String(q).toLowerCase());
  const slotStart = (s) => `${s.exam_date} ${s.slot_start_time}`;
  const bookedIn = (slotId) => db.allocations.filter((a) => a.exam_slot_id === slotId && a.registration_status !== 'cancelled').length;
  const examOf = (id) => db.examinations.find((e) => e.id === id);

  // ---------------- catalog ----------------
  const studentExam = (e) => ({
    id: e.id, exam_name: e.exam_name, description: e.description,
    registration_start_date: e.registration_start_date, registration_end_date: e.registration_end_date,
    exam_duration_minutes: e.exam_duration_minutes, fee: e.fee, status: e.status,
  });

  const catalogModel = {
    async listVisibleExams({ limit, offset, q }) {
      const all = db.examinations
        .filter((e) => VISIBLE.has(e.status) && (!q || like(e.exam_name, q)))
        .sort((a, b) =>
          (b.status === 'registration_open') - (a.status === 'registration_open') ||
          a.registration_end_date.localeCompare(b.registration_end_date) || b.id - a.id);
      return { rows: all.slice(offset, offset + limit).map(studentExam), total: all.length };
    },
    async findVisibleExam(id) {
      const e = examOf(id);
      return e && VISIBLE.has(e.status) ? { ...studentExam(e), instructions: e.instructions } : null;
    },
    async listSlotsForExam({ examinationId, centerId, date, now }) {
      return db.slots
        .filter((s) => {
          const c = db.centers.find((x) => x.id === s.center_id);
          return s.examination_id === examinationId && c && c.is_active && slotStart(s) > now &&
            (!centerId || s.center_id === centerId) && (!date || s.exam_date === date);
        })
        .sort((a, b) => slotStart(a).localeCompare(slotStart(b)) || a.id - b.id)
        .map((s) => {
          const c = db.centers.find((x) => x.id === s.center_id);
          return {
            id: s.id, examination_id: s.examination_id, center_id: c.id, center_name: c.center_name, city: c.city, state: c.state, address: c.address,
            exam_date: s.exam_date, slot_start_time: s.slot_start_time, slot_end_time: s.slot_end_time, capacity: s.capacity, booked_count: bookedIn(s.id),
          };
        });
    },
    async findActiveRegistration(studentId, examinationId) {
      const r = db.registrations.find((x) => x.student_id === studentId && x.examination_id === examinationId && x.status !== 'cancelled');
      return r ? { id: r.id, registration_id: r.registration_id, status: r.status } : null;
    },
  };

  // ---------------- registration ----------------
  const detail = (r) => {
    if (!r) return null;
    const e = examOf(r.examination_id);
    const alloc = db.allocations.find((a) => a.registration_id === r.id);
    const slot = alloc && db.slots.find((s) => s.id === alloc.exam_slot_id);
    const center = alloc && db.centers.find((c) => c.id === alloc.exam_center_id);
    return {
      id: r.id, student_id: r.student_id, registration_id: r.registration_id, application_id: r.application_id, status: r.status,
      registered_at: r.registered_at, examination_id: r.examination_id, exam_name: e.exam_name, fee: e.fee, exam_status: e.status,
      registration_end_date: e.registration_end_date,
      slot_id: slot ? slot.id : null, exam_date: slot ? slot.exam_date : null,
      slot_start_time: slot ? slot.slot_start_time : null, slot_end_time: slot ? slot.slot_end_time : null,
      center_id: center ? center.id : null, center_name: center ? center.center_name : null, city: center ? center.city : null,
      state: center ? center.state : null, address: center ? center.address : null,
      has_payment: db.payments.some((p) => p.registration_id === r.id && p.status === 'successful') ? 1 : 0,
    };
  };

  const registrationModel = {
    async findSlotRefs(slotId) {
      const s = db.slots.find((x) => x.id === slotId);
      return s ? { id: s.id, examination_id: s.examination_id, center_id: s.center_id } : null;
    },
    async lockExamShared(id) {
      const e = examOf(id);
      return e ? { id: e.id, exam_name: e.exam_name, status: e.status, registration_start_date: e.registration_start_date, registration_end_date: e.registration_end_date, fee: e.fee } : null;
    },
    async lockCenterShared(id) {
      const c = db.centers.find((x) => x.id === id);
      return c ? { id: c.id, is_active: c.is_active } : null;
    },
    async lockSlot(id) {
      const s = db.slots.find((x) => x.id === id);
      return s ? { id: s.id, examination_id: s.examination_id, center_id: s.center_id, exam_date: s.exam_date, slot_start_time: s.slot_start_time, slot_end_time: s.slot_end_time, capacity: s.capacity } : null;
    },
    async lockRegistration(id, studentId) {
      const r = db.registrations.find((x) => x.id === id && x.student_id === studentId);
      return r ? { id: r.id, status: r.status, examination_id: r.examination_id } : null;
    },
    async findActiveForStudentExam(studentId, examinationId) {
      const r = db.registrations.find((x) => x.student_id === studentId && x.examination_id === examinationId && x.status !== 'cancelled');
      return r ? { id: r.id, registration_id: r.registration_id } : null;
    },
    async insertRegistration({ studentId, examinationId, status, registrationId, applicationId }) {
      // What the database's unique key does if the application-level check was somehow bypassed.
      if (db.registrations.some((x) => x.student_id === studentId && x.examination_id === examinationId && x.status !== 'cancelled')) {
        throw Object.assign(new Error(`Duplicate entry '${studentId}-${examinationId}-1' for key 'registrations.uq_student_exam_active'`), { code: 'ER_DUP_ENTRY' });
      }
      const id = ++nextRegistrationId;
      db.registrations.push({ id, student_id: studentId, examination_id: examinationId, registration_id: registrationId, application_id: applicationId, status, registered_at: '2026-10-06 10:00:00' });
      return id;
    },
    async setCodes(id, { registrationId, applicationId }) {
      const r = db.registrations.find((x) => x.id === id);
      r.registration_id = registrationId;
      r.application_id = applicationId;
    },
    async insertAllocation({ registrationId, centerId, slotId }) {
      const r = db.registrations.find((x) => x.id === registrationId);
      db.allocations.push({ id: db.allocations.length + 1, registration_id: registrationId, exam_slot_id: slotId, exam_center_id: centerId, registration_status: r.status });
    },
    async findDetail(id) { return detail(db.registrations.find((x) => x.id === id)); },
    async findOwned(id, studentId) { return detail(db.registrations.find((x) => x.id === id && x.student_id === studentId)); },
    async listMine({ studentId, limit, offset }) {
      const all = db.registrations.filter((x) => x.student_id === studentId).sort((a, b) => b.id - a.id);
      return { rows: all.slice(offset, offset + limit).map(detail), total: all.length };
    },
    async markCancelled(id) { db.registrations.find((x) => x.id === id).status = 'cancelled'; },
    async deleteAllocation(registrationId) { db.allocations = db.allocations.filter((a) => a.registration_id !== registrationId); },
    async countSuccessfulPayments(registrationId) { return db.payments.filter((p) => p.registration_id === registrationId && p.status === 'successful').length; },
  };

  return { reset, models: { 'models/catalogModel.js': catalogModel, 'models/registrationModel.js': registrationModel } };
}

module.exports = { makeStudentFakes };
