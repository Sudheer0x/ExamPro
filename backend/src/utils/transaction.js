// src/utils/transaction.js
//
// withTransaction(async (conn) => { ... }) runs the callback inside ONE MySQL transaction:
// everything the callback did commits together, or (if it throws) is rolled back.
// Pass `conn` to every model call inside the callback, so they share the transaction.
//
// MySQL occasionally aborts one of two transactions that lock the same rows in opposite order
// (a "deadlock"). That is normal, so the whole callback is retried a couple of times.

const { pool } = require('../config/database');

const MAX_ATTEMPTS = 3;

async function runOnce(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try {
      await conn.rollback();
    } catch (_) {
      /* the connection may already be gone */
    }
    throw err;
  } finally {
    conn.release();
  }
}

async function withTransaction(fn) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runOnce(fn);
    } catch (err) {
      if (err && err.code === 'ER_LOCK_DEADLOCK' && attempt < MAX_ATTEMPTS) continue;
      throw err;
    }
  }
}

module.exports = { withTransaction };
