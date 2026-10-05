// src/models/refreshTokenModel.js — refresh_tokens table (revocable sessions).
// Only the SHA-256 hash of a token is ever stored.

const { pool } = require('../config/database');

async function create({ ownerType, ownerId, tokenHash, days }) {
  const userId = ownerType === 'staff' ? ownerId : null;
  const studentId = ownerType === 'student' ? ownerId : null;
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, student_id, token_hash, expires_at)
     VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [userId, studentId, tokenHash, days]
  );
}

async function findByHash(tokenHash) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, student_id, revoked_at, (expires_at <= NOW()) AS is_expired
       FROM refresh_tokens WHERE token_hash = ? LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

// Returns true only for the single caller that actually revoked it (blocks double-use races).
async function revokeIfActive(id) {
  const [result] = await pool.execute(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL',
    [id]
  );
  return result.affectedRows === 1;
}

async function revokeByHash(tokenHash) {
  await pool.execute('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL', [tokenHash]);
}

async function revokeAllForOwner(ownerType, ownerId) {
  const column = ownerType === 'staff' ? 'user_id' : 'student_id'; // fixed strings, not user input
  await pool.execute(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE ${column} = ? AND revoked_at IS NULL`, [ownerId]);
}

module.exports = { create, findByHash, revokeIfActive, revokeByHash, revokeAllForOwner };
