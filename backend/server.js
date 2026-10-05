// server.js
//
// This is the file you actually run: `npm run dev` (or `node server.js`).
// It checks the database is reachable BEFORE opening the port, so if
// your .env has the wrong MySQL password, you get one clear error
// message here instead of confusing failures later on every request.

require('dotenv').config();

const { validateConfig } = require('./src/config/env');
const { testConnection } = require('./src/config/database');

const PORT = process.env.PORT || 5000;

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

    app.listen(PORT, () => {
      console.log(`🚀 ExamPro backend listening on http://localhost:${PORT}`);
      console.log(`   Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (err) {
    console.error('❌ Failed to start server — could not connect to MySQL.');
    console.error(err.message);
    process.exit(1);
  }
}

start();
