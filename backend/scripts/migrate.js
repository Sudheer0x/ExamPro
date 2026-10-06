// scripts/migrate.js — the database migration runner.
//
//   npm run migrate           apply every migration that has not been applied yet
//   npm run migrate:status    show what is applied / pending (changes nothing)
//
// How it works
//   * Migrations are the numbered files in database/migrations/ (001_name.sql, 002_name.sql, ...).
//   * A table `schema_migrations` records each applied file with a SHA-256 checksum of its text.
//     The runner creates that table itself (it has to exist before anything can be recorded).
//   * Files run in number order, each only once. If an already-applied file was edited, the runner
//     REFUSES to continue (never edit an applied migration — add a new one).
//   * 001_phase2_auth.sql was applied by hand before tracking existed. If the live database already
//     shows its changes, the runner records it as "adopted" WITHOUT running it again.
//   * MySQL cannot roll back DDL (ALTER/CREATE TABLE commit immediately). So write migrations so that
//     running them twice is harmless (IF NOT EXISTS, MODIFY COLUMN ...), and fix-and-rerun if one fails.
//   * A MySQL advisory lock stops two runs at the same time.
//   * Nothing here ever drops a table or deletes data.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'database', 'migrations');
const LOCK_NAME = 'exampro_schema_migrate';
const FILENAME_RE = /^(\d{3,})_[a-z0-9_]+\.sql$/;

const BOOTSTRAP_SQL = `CREATE TABLE IF NOT EXISTS schema_migrations (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL UNIQUE,
    checksum    CHAR(64)     NOT NULL,
    adopted     TINYINT(1)   NOT NULL DEFAULT 0,
    applied_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB`;

// Migrations that may ALREADY be in a live database from before tracking existed.
// Each probe returns true only if the migration's changes are really present.
const BASELINES = {
  '001_phase2_auth.sql': async (conn) => {
    const [[row]] = await conn.query(
      `SELECT
         (SELECT CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'email_otps' AND COLUMN_NAME = 'otp_code') AS otp_len,
         (SELECT COUNT(*) FROM information_schema.TABLES
           WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'refresh_tokens') AS rt_tables`
    );
    return Number(row.otp_len) >= 255 && Number(row.rt_tables) === 1;
  },
};

// Line endings and a BOM must not change the checksum (Git on Windows can convert LF <-> CRLF).
const normalize = (text) => text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
const checksumOf = (text) => crypto.createHash('sha256').update(normalize(text)).digest('hex');

function listMigrationFiles(dir = MIGRATIONS_DIR) {
  const names = fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith('.sql'));
  const seen = new Map();
  const files = names.map((name) => {
    const m = FILENAME_RE.exec(name);
    if (!m) {
      throw new Error(`Invalid migration file name "${name}". Use NNN_description.sql (lowercase letters, digits, underscores), e.g. 002_exam_slots.sql.`);
    }
    const num = Number(m[1]);
    if (seen.has(num)) throw new Error(`Two migrations share the number ${m[1]}: ${seen.get(num)} and ${name}.`);
    seen.set(num, name);
    const sql = normalize(fs.readFileSync(path.join(dir, name), 'utf8'));
    return { name, num, sql, checksum: checksumOf(sql) };
  });
  return files.sort((a, b) => a.num - b.num);
}

async function tableExists(conn) {
  const [[row]] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'"
  );
  return Number(row.n) === 1;
}

async function loadRecorded(conn) {
  const [rows] = await conn.query('SELECT filename, checksum, adopted FROM schema_migrations ORDER BY id');
  return rows;
}

/**
 * Applies pending migrations through `conn` (a mysql2/promise connection created with multipleStatements).
 * With statusOnly=true nothing is written. Returns { applied, adopted, pending, alreadyApplied } (file names).
 */
async function runMigrations(conn, { dir = MIGRATIONS_DIR, log = console.log, statusOnly = false } = {}) {
  const files = listMigrationFiles(dir);
  const result = { applied: [], adopted: [], pending: [], alreadyApplied: [] };

  const [[lock]] = await conn.query('SELECT GET_LOCK(?, 10) AS got', [LOCK_NAME]);
  if (Number(lock.got) !== 1) throw new Error('Another migration run is in progress. Wait for it to finish and try again.');

  try {
    let recorded = [];
    if (statusOnly) {
      if (await tableExists(conn)) recorded = await loadRecorded(conn);
    } else {
      await conn.query(BOOTSTRAP_SQL);
      recorded = await loadRecorded(conn);
    }
    const recordedNames = new Set(recorded.map((r) => r.filename));

    // Integrity: an applied migration must still match the file on disk.
    for (const r of recorded) {
      const file = files.find((f) => f.name === r.filename);
      if (!file) {
        log(`⚠️  ${r.filename} is recorded as applied, but the file is missing from database/migrations/.`);
      } else if (file.checksum !== r.checksum) {
        throw new Error(
          `Migration ${r.filename} was changed after it was applied. Applied migrations must never be edited — ` +
            'restore the original file (git checkout) and put the change in a NEW migration.'
        );
      }
    }

    for (const file of files) {
      if (recordedNames.has(file.name)) {
        result.alreadyApplied.push(file.name);
        continue;
      }

      const probe = BASELINES[file.name];
      if (probe && (await probe(conn))) {
        if (statusOnly) {
          result.adopted.push(file.name);
        } else {
          await conn.query('INSERT INTO schema_migrations (filename, checksum, adopted) VALUES (?, ?, 1)', [file.name, file.checksum]);
          result.adopted.push(file.name);
          log(`↪  ${file.name}: changes already present in the database — recorded as applied (not run again).`);
        }
        continue;
      }

      if (statusOnly) {
        result.pending.push(file.name);
        continue;
      }

      log(`▶  Applying ${file.name} ...`);
      try {
        await conn.query(file.sql);
      } catch (err) {
        throw new Error(
          `Migration ${file.name} failed: ${err.message}\n` +
            '   It was NOT recorded as applied. Some of its statements may already have run (MySQL cannot roll back DDL); ' +
            'fix the cause and run it again — migrations are written to be safe to repeat.'
        );
      }
      await conn.query('INSERT INTO schema_migrations (filename, checksum, adopted) VALUES (?, ?, 0)', [file.name, file.checksum]);
      result.applied.push(file.name);
      log(`✅ ${file.name} applied.`);
    }
    return result;
  } finally {
    try {
      await conn.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]);
    } catch (_) {
      /* the lock is released automatically when the connection closes */
    }
  }
}

async function main() {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
  const mysql = require('mysql2/promise');
  const statusOnly = process.argv.includes('--status');

  const database = process.env.DB_NAME || 'exampro_db';
  const host = process.env.DB_HOST || 'localhost';
  const port = process.env.DB_PORT || 3306;
  let conn;
  try {
    conn = await mysql.createConnection({
      host,
      port,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database,
      multipleStatements: true, // a migration file contains several statements
    });
    console.log(`Database: ${database} on ${host}:${port}${statusOnly ? '  (status only — nothing will be changed)' : ''}`);

    const r = await runMigrations(conn, { statusOnly });

    if (statusOnly) {
      r.alreadyApplied.forEach((n) => console.log(`  applied  ${n}`));
      r.adopted.forEach((n) => console.log(`  would be recorded as already applied  ${n}`));
      r.pending.forEach((n) => console.log(`  PENDING  ${n}`));
      if (!r.pending.length) console.log('No pending migrations.');
    } else {
      console.log(`\nDone. Applied: ${r.applied.length}, adopted: ${r.adopted.length}, already up to date: ${r.alreadyApplied.length}.`);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    if (conn) await conn.end().catch(() => {});
  }
}

if (require.main === module) main();

module.exports = { runMigrations, listMigrationFiles, checksumOf, BASELINES, FILENAME_RE, MIGRATIONS_DIR };
