// scripts/run-db-tests.js — the ONLY supported way to run the real-database tests:  npm run test:db
//
// Those tests DROP and rebuild a database, so this wrapper refuses to start unless the target database
// is a dedicated test database: its name must end in "_test" and must not be your real DB_NAME.
// It then runs the tests with DB_NAME pointed at the test database, so the real database
// (exampro_db) is never touched. The test harness repeats the same checks as a second lock.
//
// Test database name: TEST_DB_NAME in .env (default "exampro_test").

const path = require('path');
const { spawnSync } = require('child_process');

const backend = path.join(__dirname, '..');
require('dotenv').config({ path: path.join(backend, '.env') });

const realName = process.env.DB_NAME || 'exampro_db';
const testName = process.env.TEST_DB_NAME || 'exampro_test';

function refuse(reason) {
  console.error(`❌ Refusing to run the database tests: ${reason}`);
  console.error('   Set TEST_DB_NAME in .env to a throw-away database whose name ends in "_test" (for example exampro_test).');
  process.exit(1);
}

if (!/^[A-Za-z0-9_]+_test$/.test(testName)) refuse(`TEST_DB_NAME "${testName}" does not end in "_test".`);
if (testName.toLowerCase() === realName.toLowerCase()) refuse(`TEST_DB_NAME is the same as your real database (${realName}).`);

console.log(`⚠️  The database tests will DROP and rebuild the database "${testName}" (never "${realName}").`);

const result = spawnSync(process.execPath, ['--test', '--test-force-exit', 'test/db/*.db.test.js'], {
  cwd: backend,
  stdio: 'inherit',
  env: { ...process.env, DB_NAME: testName, EXAMPRO_REAL_DB_NAME: realName, EXAMPRO_DB_TESTS: '1', NODE_ENV: 'test' },
});
process.exit(result.status === null ? 1 : result.status);
