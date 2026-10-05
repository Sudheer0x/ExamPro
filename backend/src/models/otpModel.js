// src/models/otpModel.js — email_otps table. Time comparisons are done in SQL
// (NOW()) so MySQL and Node never disagree about time zones.

const { pool } = require('../config/database');

async function secondsSinceLastOtp(email, purpose) {
  const [rows] = await pool.execute(
    `SELECT TIMESTAMPDIFF(SECOND, created_at, NOW()) AS age
       FROM email_otps WHERE email = ? AND purpose = ? ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  return rows[0] ? rows[0].age : null;
}

// Old, still-unused codes stop working the moment a new one is issued.
// (We expire them instead of deleting them, so nothing is lost.)
async function expireOpenOtps(email, purpose) {
  await pool.execute(
    `UPDATE email_otps SET expires_at = NOW()
      WHERE email = ? AND purpose = ? AND is_verified = 0 AND expires_at > NOW()`,
    [email, purpose]
  );
}

async function insert({ email, purpose, otpHash, expiryMinutes }) {
  const [result] = await pool.query(
    `INSERT INTO email_otps (email, otp_code, purpose, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))`,
    [email, otpHash, purpose, expiryMinutes]
  );
  return result.insertId;
}

async function removeById(id) {
  await pool.execute('DELETE FROM email_otps WHERE id = ?', [id]);
}

async function findLatestOpen(email, purpose) {
  const [rows] = await pool.execute(
    `SELECT id, otp_code, attempts FROM email_otps
      WHERE email = ? AND purpose = ? AND is_verified = 0 AND expires_at > NOW()
      ORDER BY id DESC LIMIT 1`,
    [email, purpose]
  );
  return rows[0] || null;
}

// Atomically count one attempt. Returns false if the attempt limit was already used up.
async function registerAttempt(id, maxAttempts) {
  const [result] = await pool.execute(
    `UPDATE email_otps SET attempts = attempts + 1
      WHERE id = ? AND attempts < ? AND is_verified = 0 AND expires_at > NOW()`,
    [id, maxAttempts]
  );
  return result.affectedRows === 1;
}

// One-time use: only the first caller flips is_verified from 0 to 1.
async function consume(id) {
  const [result] = await pool.execute(
    'UPDATE email_otps SET is_verified = 1 WHERE id = ? AND is_verified = 0 AND expires_at > NOW()',
    [id]
  );
  return result.affectedRows === 1;
}

module.exports = { secondsSinceLastOtp, expireOpenOtps, insert, removeById, findLatestOpen, registerAttempt, consume };
