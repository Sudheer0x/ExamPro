// src/config/database.js
//
// Creates a single, reusable MySQL connection pool for the whole app.
// Every model/service should import { pool } from here rather than
// opening its own connection — a pool is efficient and handles
// re-connecting for us.

const mysql = require('mysql2/promise');
require('dotenv').config();
const config = require('./env');
const { parseOffsetMinutes } = require('../utils/timezone');

const baseOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'exampro_db',
};

const pool = mysql.createPool({
  ...baseOptions,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // return DATE/DATETIME columns as plain strings, not JS Date objects
});

// TIME-ZONE POLICY (see config/env.js): every new pooled connection is switched to the fixed
// business offset before it is handed out, so all sessions agree on what NOW() means.
pool.pool.on('connection', (connection) => {
  connection.query('SET time_zone = ?', [config.db.timeZone], (err) => {
    if (err) console.error('❌ Could not set the MySQL session time zone:', err.message);
  });
});

const OFFSET_SQL = 'SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()) AS offset_min';
const fmtOffset = (min) => `UTC${min < 0 ? '-' : '+'}${String(Math.floor(Math.abs(min) / 60)).padStart(2, '0')}:${String(Math.abs(min) % 60).padStart(2, '0')}`;

/**
 * Quick connectivity check, called once when the server starts.
 * Throws if the database is unreachable or credentials are wrong,
 * so we fail loudly at startup instead of on the first real request.
 * Also proves the time-zone policy is really in effect.
 */
async function testConnection() {
  const expected = parseOffsetMinutes(config.db.timeZone);

  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    const [[row]] = await connection.query(OFFSET_SQL);
    if (Number(row.offset_min) !== expected) {
      throw new Error(
        `MySQL session time zone is ${fmtOffset(Number(row.offset_min))} but DB_TIME_ZONE=${config.db.timeZone}. ` +
          'The time-zone policy could not be applied.'
      );
    }
    console.log('✅ MySQL connection pool is ready.');
    console.log(`   Database time zone: ${config.db.timeZone} (business time)`);
  } finally {
    connection.release();
  }

  await warnIfServerZoneDiffers(expected);
}

// Informational only: DATETIME values saved before the policy existed (OTP / refresh-token expiry)
// were written in the MySQL server's own zone. If that differs, say so.
async function warnIfServerZoneDiffers(expected) {
  let raw;
  try {
    raw = await mysql.createConnection(baseOptions);
    const [[row]] = await raw.query(OFFSET_SQL);
    const serverOffset = Number(row.offset_min);
    if (serverOffset !== expected) {
      console.warn(
        `⚠️  The MySQL server's default time zone is ${fmtOffset(serverOffset)}, but ExamPro uses ${config.db.timeZone}. ` +
          'Already-stored DATETIME values (e.g. refresh-token expiry) were written in the server zone, so they may be off by the difference until they expire. ' +
          'If that is not intended, set DB_TIME_ZONE in .env to the server offset.'
      );
    }
  } catch (err) {
    console.warn('⚠️  Could not compare the server time zone:', err.message);
  } finally {
    if (raw) await raw.end().catch(() => {});
  }
}

module.exports = { pool, testConnection };
