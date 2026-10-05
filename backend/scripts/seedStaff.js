// scripts/seedStaff.js
//
// Creates a staff account (admin / invigilator / teacher) — the ONLY way staff accounts
// are created in Phase 2 (there is deliberately no public endpoint for it).
//
//   npm run seed:staff -- --role admin --email admin@example.com --name "Site Admin"
//   (it then asks for the password without echoing it)
//
// Non-interactive (e.g. scripts): set SEED_PASSWORD in the environment instead of typing it.
// It will NOT overwrite an existing account.

require('dotenv').config();
const readline = require('readline');
const { pool } = require('../src/config/database');
const { hashPassword } = require('../src/utils/password');
const userModel = require('../src/models/userModel');

const ROLES = ['admin', 'invigilator', 'teacher'];

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = function write(str) {
      if (str.includes(prompt)) rl.output.write(str); // show the prompt, hide what is typed
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

(async () => {
  try {
    const role = (arg('role') || '').toLowerCase();
    const email = (arg('email') || '').trim().toLowerCase();
    const name = (arg('name') || '').trim();

    if (!ROLES.includes(role) || !email || !name) {
      console.error('Usage: npm run seed:staff -- --role <admin|invigilator|teacher> --email <email> --name "<full name>"');
      process.exit(1);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That does not look like a valid email address.');

    const password = process.env.SEED_PASSWORD || (await askHidden('Password (min 8 chars, letters + a number): '));
    if (password.length < 8 || password.length > 64 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      throw new Error('Password must be 8-64 characters with at least one letter and one number.');
    }

    if (await userModel.findByEmailWithHash(email)) throw new Error(`A staff account with ${email} already exists. Nothing was changed.`);

    const id = await userModel.create({ full_name: name, email, password_hash: await hashPassword(password), role });
    console.log(`✅ Created ${role} account #${id} (${email}).`);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
