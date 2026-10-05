// src/models/studentModel.js — student accounts. Parameterized SQL only.

const { pool } = require('../config/database');

async function findByEmailWithHash(email) {
  const [rows] = await pool.execute(
    'SELECT id, full_name, email, mobile_number, email_verified, password_hash FROM students WHERE email = ? LIMIT 1',
    [email]
  );
  return rows[0] || null;
}

async function findAuthById(id) {
  const [rows] = await pool.execute('SELECT id, email, email_verified FROM students WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function findProfileById(id) {
  const [rows] = await pool.execute(
    'SELECT id, full_name, email, mobile_number, email_verified, created_at FROM students WHERE id = ? LIMIT 1',
    [id]
  );
  return rows[0] || null;
}

async function createPending({ full_name, email, mobile_number, date_of_birth, password_hash }) {
  const [result] = await pool.execute(
    `INSERT INTO students (full_name, email, mobile_number, date_of_birth, password_hash, email_verified)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [full_name, email, mobile_number, date_of_birth || null, password_hash]
  );
  return result.insertId;
}

// Only ever used on a row whose email is NOT yet verified (re-submitting the form).
async function updatePending(id, { full_name, mobile_number, date_of_birth, password_hash }) {
  await pool.execute(
    `UPDATE students SET full_name = ?, mobile_number = ?, date_of_birth = ?, password_hash = ?
     WHERE id = ? AND email_verified = 0`,
    [full_name, mobile_number, date_of_birth || null, password_hash, id]
  );
}

async function markEmailVerified(id) {
  await pool.execute('UPDATE students SET email_verified = 1 WHERE id = ?', [id]);
}

module.exports = { findByEmailWithHash, findAuthById, findProfileById, createPending, updatePending, markEmailVerified };
