// src/utils/registrationRules.js — pure rules shared by the student catalog and registration services.
// All times are business-time strings 'YYYY-MM-DD HH:MM:SS' taken from MySQL's clock, so plain string
// comparison is exact.

/**
 * 'upcoming' (window not started), 'open' (a student can register now) or 'closed'.
 * Registration opens at registration_start_date (inclusive) and ends at registration_end_date (exclusive).
 */
function registrationState({ status, registration_start_date: start, registration_end_date: end }, now) {
  if (status !== 'registration_open') return 'closed';
  if (now < start) return 'upcoming';
  if (now >= end) return 'closed';
  return 'open';
}

/**
 * A registration can be cancelled while the exam is still taking registrations, before the registration end,
 * before the slot starts, and only if it has no successful payment (refunds are a later phase).
 */
function canCancel({ status, examStatus, registrationEnd, slotStart, hasPayment }, now) {
  if (status === 'cancelled') return false;
  if (examStatus !== 'registration_open') return false;
  if (now >= registrationEnd) return false;
  if (slotStart && slotStart <= now) return false;
  if (hasPayment) return false;
  return true;
}

module.exports = { registrationState, canCancel };
