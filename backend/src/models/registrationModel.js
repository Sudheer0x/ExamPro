// src/models/registrationModel.js — locks, inserts and queries for student registration.
// Parameterized SQL only.
//
// LOCK ORDER (same as the admin code, so the two can never deadlock each other):
//     examination (shared)  ->  center (shared)  ->  slot (exclusive)  ->  registration (exclusive)
// Every function that is part of a transaction takes the transaction's `conn` as its LAST argument and
// must be called with it. Nothing inside a transaction may use the pool (it could starve the pool while
// holding locks).

const { pool } = require('../config/database');

const DETAIL_SELECT =
  `SELECT r.id, r.student_id, r.registration_id, r.application_id, r.status, r.registered_at, r.examination_id,
          e.exam_name, e.fee, e.status AS exam_status, e.registration_end_date,
          ca.exam_slot_id AS slot_id, s.exam_date, s.slot_start_time, s.slot_end_time,
          c.id AS center_id, c.center_name, c.city, c.state, c.address,
          EXISTS (SELECT 1 FROM payments p WHERE p.registration_id = r.id AND p.status = 'successful') AS has_payment
     FROM registrations r
     JOIN examinations e ON e.id = r.examination_id
     LEFT JOIN candidate_allocations ca ON ca.registration_id = r.id
     LEFT JOIN exam_slots s ON s.id = ca.exam_slot_id
     LEFT JOIN exam_centers c ON c.id = ca.exam_center_id`;

// ---------------- locks ----------------

/** Which exam and center a slot belongs to (plain read; the real checks happen after the locks are held). */
async function findSlotRefs(slotId, conn) {
  const [rows] = await conn.query('SELECT id, examination_id, center_id FROM exam_slots WHERE id = ? LIMIT 1', [slotId]);
  return rows[0] || null;
}

async function lockExamShared(id, conn) {
  const [rows] = await conn.query(
    `SELECT id, exam_name, status, registration_start_date, registration_end_date, fee
       FROM examinations WHERE id = ? LIMIT 1 FOR SHARE`,
    [id]
  );
  return rows[0] || null;
}

async function lockCenterShared(id, conn) {
  const [rows] = await conn.query('SELECT id, is_active FROM exam_centers WHERE id = ? LIMIT 1 FOR SHARE', [id]);
  return rows[0] || null;
}

/** THE lock that serializes seat taking: while held, nobody else can book or cancel in this slot. */
async function lockSlot(id, conn) {
  const [rows] = await conn.query(
    `SELECT id, examination_id, center_id, exam_date, slot_start_time, slot_end_time, capacity
       FROM exam_slots WHERE id = ? LIMIT 1 FOR UPDATE`,
    [id]
  );
  return rows[0] || null;
}

async function lockRegistration(id, studentId, conn) {
  const [rows] = await conn.query(
    'SELECT id, status, examination_id FROM registrations WHERE id = ? AND student_id = ? LIMIT 1 FOR UPDATE',
    [id, studentId]
  );
  return rows[0] || null;
}

// ---------------- booking ----------------

async function findActiveForStudentExam(studentId, examinationId, conn) {
  const [rows] = await conn.query(
    "SELECT id, registration_id FROM registrations WHERE student_id = ? AND examination_id = ? AND status <> 'cancelled' LIMIT 1",
    [studentId, examinationId]
  );
  return rows[0] || null;
}

async function insertRegistration({ studentId, examinationId, status, registrationId, applicationId }, conn) {
  const [result] = await conn.query(
    'INSERT INTO registrations (student_id, examination_id, registration_id, application_id, status) VALUES (?, ?, ?, ?, ?)',
    [studentId, examinationId, registrationId, applicationId, status]
  );
  return result.insertId;
}

async function setCodes(id, { registrationId, applicationId }, conn) {
  await conn.query('UPDATE registrations SET registration_id = ?, application_id = ? WHERE id = ?', [registrationId, applicationId, id]);
}

async function insertAllocation({ registrationId, centerId, slotId }, conn) {
  await conn.query('INSERT INTO candidate_allocations (registration_id, exam_center_id, exam_slot_id) VALUES (?, ?, ?)', [registrationId, centerId, slotId]);
}

// ---------------- reading ----------------

async function findDetail(id, conn = pool) {
  const [rows] = await conn.query(`${DETAIL_SELECT} WHERE r.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** A registration, only if it belongs to this student (so other students' ids look like "not found"). */
async function findOwned(id, studentId, conn = pool) {
  const [rows] = await conn.query(`${DETAIL_SELECT} WHERE r.id = ? AND r.student_id = ? LIMIT 1`, [id, studentId]);
  return rows[0] || null;
}

async function listMine({ studentId, limit, offset }, conn = pool) {
  const [rows] = await conn.query(
    `${DETAIL_SELECT} WHERE r.student_id = ? ORDER BY r.id DESC LIMIT ? OFFSET ?`,
    [studentId, limit, offset]
  );
  const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM registrations WHERE student_id = ?', [studentId]);
  return { rows, total: Number(total) };
}

// ---------------- cancelling ----------------

async function markCancelled(id, conn) {
  await conn.query("UPDATE registrations SET status = 'cancelled' WHERE id = ?", [id]);
}

/** Frees the seat: a cancelled registration keeps its history row but no longer points at a slot. */
async function deleteAllocation(registrationId, conn) {
  await conn.query('DELETE FROM candidate_allocations WHERE registration_id = ?', [registrationId]);
}

async function countSuccessfulPayments(registrationId, conn) {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM payments WHERE registration_id = ? AND status = 'successful'", [registrationId]);
  return Number(row.n);
}

module.exports = {
  findSlotRefs, lockExamShared, lockCenterShared, lockSlot, lockRegistration,
  findActiveForStudentExam, insertRegistration, setCodes, insertAllocation,
  findDetail, findOwned, listMine,
  markCancelled, deleteAllocation, countSuccessfulPayments,
};
