// src/models/computerModel.js — computers table (the PCs at a center). Parameterized SQL only.

const { pool } = require('../config/database');

const COLUMNS = 'id, center_id, pc_label, status, created_at';

/** { total, working } — "working" = every PC that is not in maintenance. */
async function countByCenter(centerId, conn = pool) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS total, COALESCE(SUM(status <> 'maintenance'), 0) AS working FROM computers WHERE center_id = ?",
    [centerId]
  );
  return { total: Number(row.total), working: Number(row.working) };
}

/** Labels that start with `prefix` (the prefix is validated to letters, digits and '-', so LIKE needs no escaping). */
async function listLabelsWithPrefix(centerId, prefix, conn = pool) {
  const [rows] = await conn.query('SELECT pc_label FROM computers WHERE center_id = ? AND pc_label LIKE ?', [centerId, `${prefix}%`]);
  return rows.map((r) => r.pc_label);
}

async function bulkInsert(centerId, labels, conn = pool) {
  await conn.query('INSERT INTO computers (center_id, pc_label) VALUES ?', [labels.map((label) => [centerId, label])]);
}

async function list({ centerId, status, limit, offset }, conn = pool) {
  const where = ['center_id = ?'];
  const params = [centerId];
  if (status) { where.push('status = ?'); params.push(status); }
  const clause = `WHERE ${where.join(' AND ')}`;
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM computers ${clause} ORDER BY id ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM computers ${clause}`, params);
  return { rows, total: Number(total) };
}

async function findById(centerId, id, conn = pool) {
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM computers WHERE id = ? AND center_id = ? LIMIT 1`, [id, centerId]);
  return rows[0] || null;
}

async function setStatus(id, status, conn = pool) {
  await conn.query('UPDATE computers SET status = ? WHERE id = ?', [status, id]);
}

async function deleteById(id, conn = pool) {
  await conn.query('DELETE FROM computers WHERE id = ?', [id]);
}

/** Candidates assigned to this PC in any slot (Phase 5 will create these). */
async function countAllocations(id, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM computer_allocations WHERE computer_id = ?', [id]);
  return Number(row.n);
}

/** Candidates assigned to this PC in slots that have not finished yet. */
async function countUpcomingAllocations(id, now, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n
       FROM computer_allocations ca JOIN exam_slots s ON s.id = ca.exam_slot_id
      WHERE ca.computer_id = ? AND TIMESTAMP(s.exam_date, s.slot_end_time) > ?`,
    [id, now]
  );
  return Number(row.n);
}

module.exports = { countByCenter, listLabelsWithPrefix, bulkInsert, list, findById, setStatus, deleteById, countAllocations, countUpcomingAllocations };
