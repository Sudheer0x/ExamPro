// test/db/dbHarness.js — safety locks and setup for the REAL-database tests.
//
//   LOCK 1: only runs when started by `npm run test:db` (EXAMPRO_DB_TESTS=1).
//   LOCK 2: the database name must end in "_test".
//   LOCK 3: the database name must differ from the real database's name.
// Only after all three does it DROP and rebuild that database from schema.sql + the migrations.
// Any failed lock throws immediately, before a single connection to MySQL is opened.

'use strict';

const path = require('path');
const fs = require('fs');

const backend = path.join(__dirname, '..', '..');
require('dotenv').config({ path: path.join(backend, '.env') });

function refuse(reason) {
  throw new Error(
    `REFUSING TO RUN DATABASE TESTS: ${reason}\n` +
      'These tests drop and rebuild their database. Start them only with:  npm run test:db'
  );
}

const dbName = process.env.DB_NAME || '';
const realName = process.env.EXAMPRO_REAL_DB_NAME || 'exampro_db';

if (process.env.EXAMPRO_DB_TESTS !== '1') refuse('they were not started through `npm run test:db`.');
if (!/^[A-Za-z0-9_]+_test$/.test(dbName)) refuse(`the database "${dbName}" does not end in "_test".`);
if (dbName.toLowerCase() === realName.toLowerCase()) refuse(`"${dbName}" is your real database.`);

process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_DISABLED = 'true';

const mysql = require('mysql2/promise');

const connectionOptions = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  multipleStatements: true,
};

/** A fresh connection to the test database (multi-statement, for running migration files). */
const openConnection = () => mysql.createConnection({ ...connectionOptions, database: dbName });

/** Drops and recreates the test database, loads schema.sql, then applies the migrations. */
async function setupDatabase() {
  const conn = await mysql.createConnection(connectionOptions);
  try {
    await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
    await conn.query(`USE \`${dbName}\``);

    const [[current]] = await conn.query('SELECT DATABASE() AS name');
    if (current.name !== dbName) refuse(`connected to "${current.name}" instead of "${dbName}".`);

    await conn.query(fs.readFileSync(path.join(backend, 'database', 'schema.sql'), 'utf8'));
    const { runMigrations } = require('../../scripts/migrate');
    await runMigrations(conn, { log: () => {} });
  } finally {
    await conn.end();
  }
}

const TABLES_TO_CLEAR = [
  'payments', 'computer_allocations', 'candidate_allocations', 'registrations', 'exam_slots',
  'computers', 'exam_centers', 'examinations', 'students',
];

/** Empties the exam-setup tables between tests (foreign-key checks are off only for the duration). */
async function resetData() {
  const { pool } = require('../../src/config/database');
  const conn = await pool.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES_TO_CLEAR) await conn.query(`TRUNCATE TABLE ${table}`);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

async function closePool() {
  const { pool } = require('../../src/config/database');
  await pool.end();
}

module.exports = { dbName, backend, openConnection, setupDatabase, resetData, closePool };
