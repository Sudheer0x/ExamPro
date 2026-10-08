// src/models/catalogModel.js — what a STUDENT is allowed to see: exams, and slots of those exams.
// Parameterized SQL only. Draft and completed exams are never returned. Nothing admin-only
// (registration counts, timestamps, internal ids) is selected.

const { pool } = require('../config/database');

const VISIBLE_STATUSES = "('registration_open', 'registration_closed', 'scheduled')";
const EXAM_COLUMNS =
  'e.id, e.exam_name, e.description, e.registration_start_date, e.registration_end_date, e.exam_duration_minutes, e.fee, e.status';

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

/** Open exams first (soonest deadline first), then closed / scheduled ones. */
async function listVisibleExams({ limit, offset, q }, conn = pool) {
  const where = [`e.status IN ${VISIBLE_STATUSES}`];
  const params = [];
  if (q) { where.push('e.exam_name LIKE ?'); params.push(`%${escapeLike(q)}%`); }
  const clause = `WHERE ${where.join(' AND ')}`;

  const [rows] = await conn.query(
    `SELECT ${EXAM_COLUMNS} FROM examinations e ${clause}
      ORDER BY (e.status = 'registration_open') DESC, e.registration_end_date ASC, e.id DESC
      LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM examinations e ${clause}`, params);
  return { rows, total: Number(total) };
}

async function findVisibleExam(id, conn = pool) {
  const [rows] = await conn.query(
    `SELECT ${EXAM_COLUMNS}, e.instructions FROM examinations e WHERE e.id = ? AND e.status IN ${VISIBLE_STATUSES} LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

/** Slots of an exam that have not started yet, at active centers, with seats booked (cancelled ones excluded). */
async function listSlotsForExam({ examinationId, centerId, date, now }, conn = pool) {
  const where = ['s.examination_id = ?', 'c.is_active = 1', 'TIMESTAMP(s.exam_date, s.slot_start_time) > ?'];
  const params = [examinationId, now];
  if (centerId) { where.push('s.center_id = ?'); params.push(centerId); }
  if (date) { where.push('s.exam_date = ?'); params.push(date); }
  const [rows] = await conn.query(
    `SELECT s.id, s.examination_id, c.id AS center_id, c.center_name, c.city, c.state, c.address,
            s.exam_date, s.slot_start_time, s.slot_end_time, s.capacity,
            (SELECT COUNT(*) FROM candidate_allocations ca JOIN registrations r ON r.id = ca.registration_id
              WHERE ca.exam_slot_id = s.id AND r.status <> 'cancelled') AS booked_count
       FROM exam_slots s JOIN exam_centers c ON c.id = s.center_id
      WHERE ${where.join(' AND ')}
      ORDER BY s.exam_date, s.slot_start_time, c.center_name, s.id
      LIMIT 1000`,
    params
  );
  return rows;
}

/** The student's own ACTIVE registration for an exam, if any. */
async function findActiveRegistration(studentId, examinationId, conn = pool) {
  const [rows] = await conn.query(
    "SELECT id, registration_id, status FROM registrations WHERE student_id = ? AND examination_id = ? AND status <> 'cancelled' LIMIT 1",
    [studentId, examinationId]
  );
  return rows[0] || null;
}

module.exports = { listVisibleExams, findVisibleExam, listSlotsForExam, findActiveRegistration };
