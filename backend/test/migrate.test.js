// Unit tests for the migration runner, using a fake in-memory "connection" (no real MySQL needed).
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runMigrations, listMigrationFiles, checksumOf, MIGRATIONS_DIR } = require('../scripts/migrate');

// A fake mysql2 connection that understands just the statements the runner sends.
function makeFakeConn({ phase2Present = false, lockAvailable = true, failOn = null } = {}) {
  const state = { tableExists: false, rows: [], executed: [], lockReleased: false };
  return {
    state,
    async query(sql, params) {
      if (sql.includes('GET_LOCK')) return [[{ got: lockAvailable ? 1 : 0 }]];
      if (sql.includes('RELEASE_LOCK')) { state.lockReleased = true; return [[{ r: 1 }]]; }
      if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) { state.tableExists = true; return [[]]; }
      if (sql.includes("TABLE_NAME = 'schema_migrations'")) return [[{ n: state.tableExists ? 1 : 0 }]];
      if (sql.includes('FROM schema_migrations')) return [state.rows.map((r) => ({ ...r }))];
      if (sql.includes('INSERT INTO schema_migrations')) {
        state.rows.push({ filename: params[0], checksum: params[1], adopted: sql.includes(', 1)') ? 1 : 0 });
        return [{}];
      }
      if (sql.includes("COLUMN_NAME = 'otp_code'")) {
        return [[phase2Present ? { otp_len: 255, rt_tables: 1 } : { otp_len: 10, rt_tables: 0 }]];
      }
      state.executed.push(sql); // otherwise: the body of a migration file
      if (failOn && sql.includes(failOn)) throw new Error('simulated SQL failure');
      return [[]];
    },
  };
}

const quiet = { log: () => {} };

describe('migration runner', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exampro-mig-'));
    fs.writeFileSync(path.join(dir, '001_phase2_auth.sql'), 'ALTER TABLE a;\r\nCREATE TABLE b;\r\n');
    fs.writeFileSync(path.join(dir, '002_next_thing.sql'), 'CREATE TABLE IF NOT EXISTS c (id INT);\n');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('adopts 001 without running it when the database already has the Phase 2 changes', async () => {
    const conn = makeFakeConn({ phase2Present: true });
    const r = await runMigrations(conn, { dir, ...quiet });
    assert.deepEqual(r.adopted, ['001_phase2_auth.sql']);
    assert.deepEqual(r.applied, ['002_next_thing.sql']);
    assert.equal(conn.state.executed.length, 1, 'only 002 is executed');
    assert.ok(!conn.state.executed[0].includes('ALTER TABLE a'), '001 must not run');
    assert.equal(conn.state.rows[0].adopted, 1);
    assert.equal(conn.state.rows[1].adopted, 0);
    assert.ok(conn.state.lockReleased);
  });

  it('runs 001 normally on a database that does not have the Phase 2 changes yet', async () => {
    const conn = makeFakeConn({ phase2Present: false });
    const r = await runMigrations(conn, { dir, ...quiet });
    assert.deepEqual(r.adopted, []);
    assert.deepEqual(r.applied, ['001_phase2_auth.sql', '002_next_thing.sql']);
    assert.equal(conn.state.executed.length, 2);
  });

  it('does nothing on a second run', async () => {
    const conn = makeFakeConn({ phase2Present: true });
    await runMigrations(conn, { dir, ...quiet });
    const before = conn.state.executed.length;
    const r = await runMigrations(conn, { dir, ...quiet });
    assert.deepEqual(r.applied, []);
    assert.deepEqual(r.alreadyApplied, ['001_phase2_auth.sql', '002_next_thing.sql']);
    assert.equal(conn.state.executed.length, before);
  });

  it('applies only the new migration when one is added later', async () => {
    const conn = makeFakeConn({ phase2Present: true });
    await runMigrations(conn, { dir, ...quiet });
    fs.writeFileSync(path.join(dir, '003_more.sql'), 'CREATE TABLE IF NOT EXISTS d (id INT);');
    const r = await runMigrations(conn, { dir, ...quiet });
    assert.deepEqual(r.applied, ['003_more.sql']);
  });

  it('stops at a failing migration, does not record it, and does not run later ones', async () => {
    fs.writeFileSync(path.join(dir, '002_next_thing.sql'), 'BREAK THIS;');
    fs.writeFileSync(path.join(dir, '003_after.sql'), 'CREATE TABLE IF NOT EXISTS e (id INT);');
    const conn = makeFakeConn({ phase2Present: true, failOn: 'BREAK THIS' });
    await assert.rejects(() => runMigrations(conn, { dir, ...quiet }), /002_next_thing\.sql failed/);
    assert.deepEqual(conn.state.rows.map((r) => r.filename), ['001_phase2_auth.sql']);
    assert.ok(!conn.state.executed.some((s) => s.includes('TABLE IF NOT EXISTS e')));
    assert.ok(conn.state.lockReleased, 'lock released even on failure');
  });

  it('refuses to continue if an applied migration file was edited', async () => {
    const conn = makeFakeConn({ phase2Present: true });
    await runMigrations(conn, { dir, ...quiet });
    fs.appendFileSync(path.join(dir, '002_next_thing.sql'), '\n-- sneaky edit\n');
    fs.writeFileSync(path.join(dir, '003_more.sql'), 'CREATE TABLE IF NOT EXISTS d (id INT);');
    const before = conn.state.executed.length;
    await assert.rejects(() => runMigrations(conn, { dir, ...quiet }), /was changed after it was applied/);
    assert.equal(conn.state.executed.length, before, '003 must not run');
  });

  it('status mode changes nothing', async () => {
    const conn = makeFakeConn({ phase2Present: true });
    const r = await runMigrations(conn, { dir, statusOnly: true, ...quiet });
    assert.deepEqual(r.adopted, ['001_phase2_auth.sql']);
    assert.deepEqual(r.pending, ['002_next_thing.sql']);
    assert.equal(conn.state.tableExists, false);
    assert.equal(conn.state.rows.length, 0);
    assert.equal(conn.state.executed.length, 0);
  });

  it('errors if another run holds the lock', async () => {
    const conn = makeFakeConn({ lockAvailable: false });
    await assert.rejects(() => runMigrations(conn, { dir, ...quiet }), /Another migration run is in progress/);
    assert.equal(conn.state.executed.length, 0);
  });

  it('checksums ignore Windows line endings and a BOM', () => {
    assert.equal(checksumOf('a\r\nb\r\n'), checksumOf('a\nb\n'));
    assert.equal(checksumOf('\uFEFFa\nb'), checksumOf('a\nb'));
    assert.notEqual(checksumOf('a\nb'), checksumOf('a\nc'));
  });

  it('rejects badly named files and duplicate numbers', () => {
    fs.writeFileSync(path.join(dir, 'fix.sql'), 'SELECT 1;');
    assert.throws(() => listMigrationFiles(dir), /Invalid migration file name "fix\.sql"/);
    fs.rmSync(path.join(dir, 'fix.sql'));
    fs.writeFileSync(path.join(dir, '002_other.sql'), 'SELECT 1;');
    assert.throws(() => listMigrationFiles(dir), /share the number 002/);
  });

  it('the project\'s real migrations folder is valid', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    assert.ok(files.length >= 1);
    assert.equal(files[0].name, '001_phase2_auth.sql');
    for (const f of files) assert.ok(!/\bDROP\s+(TABLE|DATABASE)\b/i.test(f.sql), `${f.name} must not drop anything`);
  });
});
