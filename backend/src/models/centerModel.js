// src/models/centerModel.js — exam_centers table. Parameterized SQL only.
// PC counts are always COMPUTED from the computers table (the source of truth); the two counter
// columns on exam_centers are kept in sync by syncComputerCounts() for reports and backward compatibility.

const { pool } = require('../config/database');

const COLUMNS =
  'c.id, c.center_name, c.address, c.city, c.state, c.is_active, c.created_at, ' +
  '(SELECT COUNT(*) FROM computers p WHERE p.center_id = c.id) AS total_computers, ' +
  "(SELECT COUNT(*) FROM computers p WHERE p.center_id = c.id AND p.status <> 'maintenance') AS working_computers";

const EDITABLE = ['center_name', 'address', 'city', 'state', 'is_active'];
const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

async function insert({ center_name, address, city, state }, conn = pool) {
  const [result] = await conn.query('INSERT INTO exam_centers (center_name, address, city, state) VALUES (?, ?, ?, ?)', [center_name, address, city, state]);
  return result.insertId;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM exam_centers c WHERE c.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** Locks the center row until the transaction ends. Returns { id } or null. */
async function lockById(id, conn) {
  const [rows] = await conn.query('SELECT c.id FROM exam_centers c WHERE c.id = ? LIMIT 1 FOR UPDATE', [id]);
  return rows[0] || null;
}

async function list({ limit, offset, city, state, is_active, q }, conn = pool) {
  const where = [];
  const params = [];
  if (city) { where.push('c.city = ?'); params.push(city); }
  if (state) { where.push('c.state = ?'); params.push(state); }
  if (is_active !== undefined) { where.push('c.is_active = ?'); params.push(is_active ? 1 : 0); }
  if (q) { where.push('c.center_name LIKE ?'); params.push(`%${escapeLike(q)}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM exam_centers c ${clause} ORDER BY c.id DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM exam_centers c ${clause}`, params);
  return { rows, total: Number(total) };
}

async function update(id, fields, conn = pool) {
  const sets = [];
  const params = [];
  for (const column of EDITABLE) {
    if (fields[column] !== undefined) {
      sets.push(`${column} = ?`);
      params.push(column === 'is_active' ? (fields[column] ? 1 : 0) : fields[column]);
    }
  }
  if (!sets.length) return;
  await conn.query(`UPDATE exam_centers SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

async function deleteById(id, conn = pool) {
  await conn.query('DELETE FROM exam_centers WHERE id = ?', [id]); // its computers go with it (ON DELETE CASCADE)
}

/** Re-computes the two counter columns from the computers table (one statement, so the CHECK sees both). */
async function syncComputerCounts(id, conn = pool) {
  await conn.query(
    `UPDATE exam_centers c SET
       c.max_capacity        = (SELECT COUNT(*) FROM computers p WHERE p.center_id = c.id),
       c.available_computers = (SELECT COUNT(*) FROM computers p WHERE p.center_id = c.id AND p.status <> 'maintenance')
     WHERE c.id = ?`,
    [id]
  );
}

async function countSlots(id, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM exam_slots WHERE center_id = ?', [id]);
  return Number(row.n);
}

/** Slots that have not finished yet (compared with the business-time string `now`). */
async function countUpcomingSlots(id, now, conn = pool) {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM exam_slots WHERE center_id = ? AND TIMESTAMP(exam_date, slot_end_time) > ?', [id, now]);
  return Number(row.n);
}

/** Candidates booked into slots at this center that have not finished yet. */
async function hasUpcomingAllocatedSlots(id, now, conn = pool) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS n
       FROM exam_slots s JOIN candidate_allocations ca ON ca.exam_slot_id = s.id
      WHERE s.center_id = ? AND TIMESTAMP(s.exam_date, s.slot_end_time) > ?`,
    [id, now]
  );
  return Number(row.n) > 0;
}

module.exports = { insert, findById, lockById, list, update, deleteById, syncComputerCounts, countSlots, countUpcomingSlots, hasUpcomingAllocatedSlots };
