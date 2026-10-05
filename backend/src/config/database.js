// src/config/database.js
//
// Creates a single, reusable MySQL connection pool for the whole app.
// Every model/service should import { pool } from here rather than
// opening its own connection — a pool is efficient and handles
// re-connecting for us.

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'exampro_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // return DATE/DATETIME columns as plain strings, not JS Date objects
});

/**
 * Quick connectivity check, called once when the server starts.
 * Throws if the database is unreachable or credentials are wrong,
 * so we fail loudly at startup instead of on the first real request.
 */
async function testConnection() {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    console.log('✅ MySQL connection pool is ready.');
  } finally {
    connection.release();
  }
}

module.exports = { pool, testConnection };
