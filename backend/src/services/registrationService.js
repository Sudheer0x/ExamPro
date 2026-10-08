// src/services/registrationService.js — a student registers for an exam slot, lists, and cancels.
//
// SAFETY MODEL (why two students can never take the last seat):
//   * The whole booking runs in ONE transaction at READ COMMITTED.
//   * It locks, in this fixed order: examination (shared) -> center (shared) -> slot (EXCLUSIVE).
//     The exclusive slot lock serializes everyone booking or cancelling in that slot, so the seat count
//     taken under the lock is exact. Shared locks on the exam and center stop an admin closing registration
//     or deactivating the center in the middle of a booking, and match the admin code's lock order
//     (examination -> center -> slot), so the two can never deadlock.
//   * Duplicates are stopped twice: by a check under the lock, and by the database itself
//     (unique key uq_student_exam_active) for the case of the same student hitting two different slots at once.
//   * Nothing inside the transaction may touch the pool (only `conn`).
// The student's id ALWAYS comes from the verified login, never from the request.

const config = require('../config/env');
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/transaction');
const { canCancel } = require('../utils/registrationRules');
const { placeholderCode, buildCodes } = require('../utils/registrationIds');
const registrationModel = require('../models/registrationModel');
const slotModel = require('../models/slotModel');
const studentModel = require('../models/studentModel');
const clockModel = require('../models/clockModel');

const VISIBLE = new Set(['registration_open', 'registration_closed', 'scheduled']);
const TX_OPTIONS = { isolationLevel: 'READ COMMITTED' };

const fail = (status, message, code, details) => new AppError(message, status, { code, ...(details ? { details } : {}) });
const slotNotFound = () => fail(404, 'Slot not found.', 'SLOT_NOT_FOUND');
const registrationNotFound = () => fail(404, 'Registration not found.', 'REGISTRATION_NOT_FOUND');

function serialize(row, now) {
  const slotStart = row.exam_date ? `${row.exam_date} ${row.slot_start_time}` : null;
  return {
    id: row.id,
    registration_id: row.registration_id,
    application_id: row.application_id,
    status: row.status,
    registered_at: row.registered_at,
    can_cancel: canCancel(
      { status: row.status, examStatus: row.exam_status, registrationEnd: row.registration_end_date, slotStart, hasPayment: Boolean(Number(row.has_payment)) },
      now
    ),
    examination: {
      id: row.examination_id,
      exam_name: row.exam_name,
      fee: row.fee,
      status: row.exam_status,
      registration_end_date: row.registration_end_date,
    },
    center: row.center_id
      ? { id: row.center_id, center_name: row.center_name, city: row.city, state: row.state, address: row.address }
      : null,
    slot: row.slot_id
      ? { id: row.slot_id, exam_date: row.exam_date, slot_start_time: row.slot_start_time, slot_end_time: row.slot_end_time }
      : null,
    timezone: config.db.timeZone,
  };
}

// ------------------------------------------------------------------ register

async function register(studentId, slotId) {
  // The login already proved this is a verified student; re-check cheaply, OUTSIDE the transaction.
  const student = await studentModel.findAuthById(studentId);
  if (!student || !student.email_verified) throw fail(403, 'Your account cannot register for exams.', 'ACCOUNT_NOT_ELIGIBLE');

  return withTransaction(async (conn) => {
    // 1. Which exam and center does the slot belong to? (plain read; re-verified under the locks below)
    const refs = await registrationModel.findSlotRefs(slotId, conn);
    if (!refs) throw slotNotFound();

    // 2. Locks, always in this order.
    const exam = await registrationModel.lockExamShared(refs.examination_id, conn);
    if (!exam || !VISIBLE.has(exam.status)) throw slotNotFound(); // draft / completed exams do not exist for students
    const center = await registrationModel.lockCenterShared(refs.center_id, conn);
    if (!center) throw slotNotFound();
    const slot = await registrationModel.lockSlot(slotId, conn);
    if (!slot || slot.examination_id !== refs.examination_id || slot.center_id !== refs.center_id) throw slotNotFound();

    // 3. Rules, checked against the locked rows and MySQL's clock.
    const now = await clockModel.now(conn);
    if (exam.status !== 'registration_open') throw fail(409, 'Registration is not open for this examination.', 'REGISTRATION_NOT_OPEN');
    if (now < exam.registration_start_date) {
      throw fail(409, 'Registration for this examination has not started yet.', 'REGISTRATION_NOT_STARTED', { registration_start_date: exam.registration_start_date });
    }
    if (now >= exam.registration_end_date) {
      throw fail(409, 'Registration for this examination has closed.', 'REGISTRATION_CLOSED', { registration_end_date: exam.registration_end_date });
    }
    if (`${slot.exam_date} ${slot.slot_start_time}` <= now) throw fail(409, 'This slot has already started.', 'SLOT_STARTED');
    if (!center.is_active) throw fail(409, 'This exam center is not available.', 'CENTER_INACTIVE');

    const existing = await registrationModel.findActiveForStudentExam(studentId, exam.id, conn);
    if (existing) {
      throw fail(409, 'You are already registered for this examination.', 'DUPLICATE_REGISTRATION', { registration_id: existing.registration_id });
    }

    const booked = await slotModel.bookedCount(slotId, conn); // exact: we hold the slot lock
    if (booked >= Number(slot.capacity)) throw fail(409, 'This slot is full.', 'SLOT_FULL');

    // 4. Book it.
    const status = Number(exam.fee) > 0 ? 'pending_payment' : 'completed';
    let id;
    try {
      id = await registrationModel.insertRegistration(
        { studentId, examinationId: exam.id, status, registrationId: placeholderCode(), applicationId: placeholderCode() },
        conn
      );
    } catch (err) {
      if (err && err.code === 'ER_DUP_ENTRY' && /uq_student_exam_active/.test(err.message || '')) {
        throw fail(409, 'You are already registered for this examination.', 'DUPLICATE_REGISTRATION');
      }
      throw err;
    }
    const codes = buildCodes(now.slice(0, 4), id);
    await registrationModel.setCodes(id, { registrationId: codes.registration_id, applicationId: codes.application_id }, conn);
    await registrationModel.insertAllocation({ registrationId: id, centerId: slot.center_id, slotId }, conn);

    return serialize(await registrationModel.findDetail(id, conn), now);
  }, TX_OPTIONS);
}

// ------------------------------------------------------------------ mine

async function listMine(studentId, { page, limit }) {
  const now = await clockModel.now();
  const { rows, total } = await registrationModel.listMine({ studentId, limit, offset: (page - 1) * limit });
  return { registrations: rows.map((r) => serialize(r, now)), page, limit, total };
}

// ------------------------------------------------------------------ cancel

async function cancel(studentId, registrationId) {
  return withTransaction(async (conn) => {
    // Another student's registration looks exactly like one that does not exist.
    const owned = await registrationModel.findOwned(registrationId, studentId, conn);
    if (!owned) throw registrationNotFound();
    if (owned.status === 'cancelled') throw fail(409, 'This registration is already cancelled.', 'ALREADY_CANCELLED');

    // Same lock order as booking: examination (shared) -> slot (exclusive) -> the registration row.
    const exam = await registrationModel.lockExamShared(owned.examination_id, conn);
    if (owned.slot_id) await registrationModel.lockSlot(owned.slot_id, conn);
    const reg = await registrationModel.lockRegistration(registrationId, studentId, conn);
    if (!reg) throw registrationNotFound();
    if (reg.status === 'cancelled') throw fail(409, 'This registration is already cancelled.', 'ALREADY_CANCELLED');

    const now = await clockModel.now(conn);
    const slotStart = owned.exam_date ? `${owned.exam_date} ${owned.slot_start_time}` : null;
    if (exam.status !== 'registration_open' || now >= exam.registration_end_date || (slotStart && slotStart <= now)) {
      throw fail(409, 'Registrations can no longer be cancelled for this examination.', 'CANCELLATION_CLOSED');
    }
    if ((await registrationModel.countSuccessfulPayments(registrationId, conn)) > 0) {
      throw fail(409, 'A payment has been received for this registration, so it cannot be cancelled online. Please contact support.', 'PAYMENT_RECEIVED');
    }

    await registrationModel.markCancelled(registrationId, conn);
    await registrationModel.deleteAllocation(registrationId, conn); // frees the seat
    return serialize(await registrationModel.findDetail(registrationId, conn), now);
  }, TX_OPTIONS);
}

module.exports = { register, listMine, cancel };
