// src/models/userModel.js — staff accounts (admin / teacher / invigilator). Parameterized SQL only.

const { pool } = require('../config/database');

// Never select password_hash unless the caller truly needs it (login only).
const SAFE_COLUMNS = 'id, full_name, email, role, is_active, created_at, updated_at';

async function findByEmailWithHash(email) {
  const [rows] = await pool.execute(
    'SELECT id, full_name, email, password_hash, role, is_active FROM users WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function findAuthById(id) {
  const [rows] = await pool.execute('SELECT id, email, role, is_active FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findPublicById(id) {
  const [rows] = await pool.execute(`SELECT ${SAFE_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return rows[0] || null;
}

async function list({ limit, offset, role }) {
  // limit/offset are validated integers by the time they get here.
  const where = role ? 'WHERE role = ?' : '';
  const params = role ? [role] : [];
  const [rows] = await pool.query(
    `SELECT ${SAFE_COLUMNS} FROM users ${where} ORDER BY id ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);
  return { rows, total };
}

async function create({ full_name, email, password_hash, role }) {
  const [result] = await pool.execute(
    'INSERT INTO users (full_name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [full_name, email, password_hash, role]
  );
  return result.insertId;
}

module.exports = { findByEmailWithHash, findAuthById, findPublicById, list, create };
