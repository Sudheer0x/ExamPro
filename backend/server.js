// server.js
//
// This is the file you actually run: `npm run dev` (or `node server.js`).
// It checks the database is reachable BEFORE opening the port, so if
// your .env has the wrong MySQL password, you get one clear error
// message here instead of confusing failures later on every request.
//
// It also handles shutting down cleanly (Ctrl+C / SIGTERM) and logs-then-exits
// on errors nobody caught, instead of limping on in an unknown state.

require('dotenv').config();

const { validateConfig } = require('./src/config/env');
const { testConnection, pool } = require('./src/config/database');

const PORT = process.env.PORT || 5000;

let server = null;
let shuttingDown = false;

/**
 * Graceful shutdown: stop accepting new connections, let requests that are
 * already running finish, close the MySQL pool, then exit. A timer forces the
 * exit if something hangs (a crash gets a shorter grace period than Ctrl+C).
 */
async function shutdown(reason, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n🛑 Shutting down (${reason})...`);

  const timer = setTimeout(() => {
    console.error('⏱️  Shutdown timed out — forcing exit.');
    process.exit(exitCode || 1);
  }, exitCode === 0 ? 10000 : 3000);
  timer.unref();

  try {
    if (server) {
      await new Promise((resolve) => {
        server.close(() => resolve()); // resolves once every in-flight request has finished
        if (server.closeIdleConnections) server.closeIdleConnections(); // don't wait on idle keep-alive sockets
      });
    }
    await pool.end();
    console.log('✅ Shutdown complete.');
  } catch (err) {
    console.error('❌ Error during shutdown:', err.message);
    exitCode = exitCode || 1;
  }
  process.exit(exitCode);
}

process.on('SIGINT', () => shutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => shutdown('SIGTERM')); // process managers / hosting platforms
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK')); // Ctrl+Break on Windows

// A promise failed and nobody handled it: that is a bug. Log it, then exit so a process manager can restart cleanly.
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled promise rejection:', reason instanceof Error ? reason.stack : String(reason));
  shutdown('unhandledRejection', 1);
});

// A synchronous error escaped everything. The process state is unknown, so it must NOT keep serving requests.
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught exception:', err && err.stack ? err.stack : String(err));
  shutdown('uncaughtException', 1);
});

async function start() {
  // Check the auth-related settings in .env first, so a missing JWT_SECRET gives one clear message.
  try {
    validateConfig();
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const app = require('./src/app');

  try {
    await testConnection();
  } catch (err) {
    console.error('❌ Failed to start server — the database check failed (connection or time zone).');
    console.error(err.message);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`🚀 ExamPro backend listening on http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use. Stop the other ExamPro/Node process, or set PORT in .env.`);
    } else {
      console.error('❌ Server error:', err.message);
    }
    process.exit(1);
  });
}

start();
