// src/utils/registrationIds.js — public registration / application codes.
//
// A row is first inserted with a throw-away unique placeholder, then given its real codes built from the
// row's own auto-increment id, inside the same transaction. The database hands out each id exactly once, so
// two simultaneous registrations can never get the same code (no MAX()+1 anywhere).

const crypto = require('crypto');

/** Unique throw-away code (28 chars, fits VARCHAR(30)). */
const placeholderCode = () => `TMP-${crypto.randomBytes(12).toString('hex')}`;

/** { registration_id: 'EXP2026000042', application_id: 'APP2026000042' } */
function buildCodes(year, id) {
  const serial = String(id).padStart(6, '0');
  return { registration_id: `EXP${year}${serial}`, application_id: `APP${year}${serial}` };
}

module.exports = { placeholderCode, buildCodes };
