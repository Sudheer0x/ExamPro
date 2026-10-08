// src/models/slotModel.js — exam_slots table. Parameterized SQL only.
// "Booked" seats = candidate_allocations whose registration is not cancelled.

const { pool } = require('../config/database');

const SLOT_COLUMNS =
  's.id, s.examination_id, s.center_id, c.center_name, c.city, s.exam_date, s.slot_start_time, s.slot_end_time, s.capacity, s.created_at, ' +
  "(SELECT COUNT(*) FROM candidate_allocations ca JOIN registrations r ON r.id = ca.registration_id WHERE ca.exam_slot_id = s.id AND r.status <> 'cancelled') AS booked_count";

async function insert({ examination_id, center_id, exam_date, slot_start_time, slot_end_time, capacity }, conn = pool) {
  const [result] = await conn.query(
    'INSERT INTO exam_slots (examination_id, center_id, exam_date, slot_start_time, slot_end_time, capacity) VALUES (?, ?, ?, ?, ?, ?)',
    [examination_id, center_id, exam_date, slot_start_time, slot_end_time, capacity]
  );
  return result.insertId;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.query(`SELECT ${SLOT_COLUMNS} FROM exam_slots s JOIN exam_centers c ON c.id = s.center_id WHERE s.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** Locks the slot row until the transaction ends, then returns it. */
async function lockById(id, conn) {
  const [locked] = await conn.query('SELECT id FROM exam_slots WHERE id = ? LIMIT 1 FOR UPDATE', [id]);
  if (!locked.length) return null;
  return findById(id, conn);
}

async function listByExamination({ examinationId, centerId, date }, conn = pool) {
  const where = ['s.examination_id = ?'];
  const params = [examinationId];
  if (centerId) { where.push('s.center_id = ?'); params.push(centerId); }
  if (date) { where.push('s.exam_date = ?'); params.push(date); }
  const [rows] = await conn.query(
    `SELECT ${SLOT_COLUMNS} FROM exam_slots s JOIN exam_centers c ON c.id = s.center_id
      WHERE ${where.join(' AND ')} ORDER BY s.exam_date, s.slot_start_time, s.id LIMIT 1000`,
    params
  );
  return rows;
}

/** Other slots at the same center and date whose time range overlaps [start, end). */
async function listOverlapping({ centerId, date, start, end, excludeId }, conn = pool) {
  const params = [centerId, date, end, start];
  let extra = '';
  if (excludeId) { extra = ' AND id <> ?'; params.push(excludeId); }
  const [rows] = await conn.query(
    `SELECT id, examination_id, slot_start_time, slot_end_time, capacity FROM exam_slots
      WHERE center_id = ? AND exam_date = ? AND slot_start_time < ? AND slot_end_time > ?${extra}`,
    params
  );
  return rows;
}

/** Slots at a center that have not finished yet (used to check PC changes against future demand). */
async function listUpcomingByCenter(centerId, now, conn = pool) {
  const [rows] = await conn.query(
    'SELECT id, exam_date, slot_start_time, slot_end_time, capacity FROM exam_slots WHERE center_id = ? AND TIMESTAMP(exam_date, slot_end_time) > ?',
    [centerId, now]
  );
  return rows;
}

async function findDuplicate({ examinationId, centerId, date, start }, conn = pool) {
  const [rows] = await conn.query(
    'SELECT id FROM exam_slots WHERE examination_id = ? AND center_id = ? AND exam_date = ? AND slot_start_time = ? LIMIT 1',
    [examinationId, centerId, date, start]
  );
  return rows[0] || null;
}

async function update(id, { capacity }, conn = pool) {
  await conn.query('UPDATE exam_slots SET capacity = ? WHERE id = ?', [capacity, id]);
}

async function deleteById(id, conn = pool) {
  await conn.query('DELETE FROM exam_slots WHERE id = ?', [id]);
}

/** Every candidate row pointing at the slot, cancelled or not (the foreign key blocks deleting while any exist). */
async function countAllocations(id, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM candidate_allocations WHERE exam_slot_id = ?', [id]);
  return Number(row.n);
}

async function bookedCount(id, conn = pool) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM candidate_allocations ca JOIN registrations r ON r.id = ca.registration_id WHERE ca.exam_slot_id = ? AND r.status <> 'cancelled'",
    [id]
  );
  return Number(row.n);
}

async function countByExamination(examinationId, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM exam_slots WHERE examination_id = ?', [examinationId]);
  return Number(row.n);
}

/** Length in minutes of the shortest slot of an exam, or null if it has none. */
async function shortestSlotMinutes(examinationId, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT MIN(TIME_TO_SEC(TIMEDIFF(slot_end_time, slot_start_time))) / 60 AS minutes FROM exam_slots WHERE examination_id = ?',
    [examinationId]
  );
  return row.minutes === null ? null : Number(row.minutes);
}

async function countSlotsAtInactiveCenters(examinationId, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS n FROM exam_slots s JOIN exam_centers c ON c.id = s.center_id WHERE s.examination_id = ? AND c.is_active = 0',
    [examinationId]
  );
  return Number(row.n);
}

async function countUnfinishedSlots(examinationId, now, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM exam_slots WHERE examination_id = ? AND TIMESTAMP(exam_date, slot_end_time) > ?', [examinationId, now]);
  return Number(row.n);
}

module.exports = {
  insert, findById, lockById, listByExamination, listOverlapping, listUpcomingByCenter, findDuplicate, update, deleteById,
  countAllocations, bookedCount, countByExamination, shortestSlotMinutes, countSlotsAtInactiveCenters, countUnfinishedSlots,
};
