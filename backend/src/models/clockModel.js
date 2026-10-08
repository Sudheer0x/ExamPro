// src/models/clockModel.js — the ONE source of "now" for business rules: MySQL's own clock.
// Every connection runs in the business time zone (see config/env.js), so this is business time,
// as 'YYYY-MM-DD HH:MM:SS'. Such strings compare correctly as plain text.

const { pool } = require('../config/database');

async function now(conn = pool) {
  const [[row]] = await conn.query("SELECT DATE_FORMAT(NOW(), '%Y-%m-%d %H:%i:%s') AS now_str");
  return row.now_str;
}

module.exports = { now };
