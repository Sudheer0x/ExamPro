// src/utils/password.js
//
// Password hashing with bcrypt (already a dependency; Argon2 needs a native
// build step that often fails on Windows). Cost factor 12.

const bcrypt = require('bcrypt');
const config = require('../config/env');

const hashPassword = (plain) => bcrypt.hash(plain, config.bcryptRounds);
const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

// A real bcrypt hash of a random string. When the email is unknown we still
// run one comparison against this so a "no such user" login takes about as
// long as a "wrong password" login (prevents timing-based account discovery).
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(require('crypto').randomBytes(16).toString('hex'), config.bcryptRounds);
  }
  return dummyHashPromise;
}
async function burnComparison(plain) {
  await bcrypt.compare(plain, await getDummyHash());
}

module.exports = { hashPassword, comparePassword, burnComparison };
