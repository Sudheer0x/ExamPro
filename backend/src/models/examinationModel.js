// src/models/examinationModel.js — examinations table. Parameterized SQL only.
// Every function takes an optional last argument `conn`: pass the connection from withTransaction()
// to take part in a transaction; leave it out to use the pool.

const { pool } = require('../config/database');

const COLUMNS =
  'e.id, e.exam_name, e.description, e.instructions, e.registration_start_date, e.registration_end_date, ' +
  'e.exam_duration_minutes, e.fee, e.status, e.created_at, e.updated_at';

// Only these columns can ever be changed through update(); the column names come from this fixed list, never from the client.
const EDITABLE = ['exam_name', 'description', 'instructions', 'registration_start_date', 'registration_end_date', 'exam_duration_minutes', 'fee'];

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

async function insert(data, conn = pool) {
  const [result] = await conn.query(
    `INSERT INTO examinations
       (exam_name, description, instructions, registration_start_date, registration_end_date, exam_duration_minutes, fee)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [data.exam_name, data.description, data.instructions, data.registration_start_date, data.registration_end_date, data.exam_duration_minutes, data.fee]
  );
  return result.insertId;
}

async function findById(id, conn = pool) {
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM examinations e WHERE e.id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

/** Locks the row until the transaction ends (SELECT ... FOR UPDATE) and returns it. */
async function lockById(id, conn) {
  const [rows] = await conn.query(`SELECT ${COLUMNS} FROM examinations e WHERE e.id = ? LIMIT 1 FOR UPDATE`, [id]);
  return rows[0] || null;
}

async function list({ limit, offset, status, q }, conn = pool) {
  const where = [];
  const params = [];
  if (status) { where.push('e.status = ?'); params.push(status); }
  if (q) { where.push('e.exam_name LIKE ?'); params.push(`%${escapeLike(q)}%`); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await conn.query(
    `SELECT ${COLUMNS},
            (SELECT COUNT(*) FROM exam_slots s WHERE s.examination_id = e.id) AS slot_count,
            (SELECT COUNT(*) FROM registrations r WHERE r.examination_id = e.id AND r.status <> 'cancelled') AS registration_count
       FROM examinations e ${clause}
      ORDER BY e.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await conn.query(`SELECT COUNT(*) AS total FROM examinations e ${clause}`, params);
  return { rows, total: Number(total) };
}

async function update(id, fields, conn = pool) {
  const sets = [];
  const params = [];
  for (const column of EDITABLE) {
    if (fields[column] !== undefined) { sets.push(`${column} = ?`); params.push(fields[column]); }
  }
  if (!sets.length) return;
  await conn.query(`UPDATE examinations SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
}

async function setStatus(id, status, conn = pool) {
  await conn.query('UPDATE examinations SET status = ? WHERE id = ?', [status, id]);
}

async function countRegistrations(id, conn = pool) {
  const [[row]] = await conn.query("SELECT COUNT(*) AS n FROM registrations WHERE examination_id = ? AND status <> 'cancelled'", [id]);
  return Number(row.n);
}

async function getSummary(id, conn = pool) {
  const [[row]] = await conn.query(
    'SELECT COUNT(*) AS slot_count, COALESCE(SUM(capacity), 0) AS total_capacity FROM exam_slots WHERE examination_id = ?',
    [id]
  );
  return {
    slot_count: Number(row.slot_count),
    total_capacity: Number(row.total_capacity),
    registration_count: await countRegistrations(id, conn),
  };
}

module.exports = { insert, findById, lockById, list, update, setStatus, getSummary, countRegistrations };
