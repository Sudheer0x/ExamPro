// src/services/authService.js — registration, OTP verification, login, refresh, logout.
// Controllers call these; these call the models. No req/res objects in here.

const AppError = require('../utils/AppError');
const { hashPassword, comparePassword, burnComparison } = require('../utils/password');
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');
const refreshTokenModel = require('../models/refreshTokenModel');
const otpService = require('./otpService');
const tokenService = require('./tokenService');

// ----- helpers ---------------------------------------------------------

const staffRole = (dbRole) => String(dbRole).toUpperCase(); // 'admin' -> 'ADMIN'

function safeStaff(u) {
  return { id: u.id, full_name: u.full_name, email: u.email, role: staffRole(u.role) };
}
function safeStudent(s) {
  return { id: s.id, full_name: s.full_name, email: s.email, role: 'STUDENT', email_verified: Boolean(s.email_verified) };
}

async function startSession(ownerType, ownerId) {
  return {
    accessToken: tokenService.signAccessToken(ownerType, ownerId),
    refreshToken: await tokenService.createRefreshToken(ownerType, ownerId),
  };
}

// ----- student registration + OTP -------------------------------------

async function registerStudent({ full_name, email, mobile_number, date_of_birth, password }) {
  const existing = await studentModel.findByEmailWithHash(email);
  if (existing && existing.email_verified) {
    throw new AppError('An account with this email already exists.', 409);
  }

  const password_hash = await hashPassword(password);
  const fields = { full_name, mobile_number, date_of_birth, password_hash };

  if (existing) {
    // Earlier attempt never verified its email: let the person correct their details.
    await studentModel.updatePending(existing.id, fields);
  } else {
    try {
      await studentModel.createPending({ email, ...fields });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new AppError('An account with this email already exists.', 409);
      throw err;
    }
  }

  await otpService.issueOtp(email);
}

async function resendRegistrationOtp(email) {
  const student = await studentModel.findByEmailWithHash(email);
  // Same answer whether or not the email exists, so this can't be used to discover accounts.
  if (student && !student.email_verified) await otpService.issueOtp(email);
}

async function verifyRegistrationOtp({ email, otp }) {
  const student = await studentModel.findByEmailWithHash(email);
  if (!student) throw new AppError('Invalid or expired OTP.', 400);
  if (student.email_verified) throw new AppError('This email is already verified. Please log in.', 409);

  await otpService.verifyOtp(email, otp);
  await studentModel.markEmailVerified(student.id);
}

// ----- login ----------------------------------------------------------

async function login({ email, password, account_type }) {
  // Staff (users) and students live in different tables. Collect the matching
  // account(s) and accept the first whose password matches.
  const candidates = [];
  if (account_type !== 'student') {
    const u = await userModel.findByEmailWithHash(email);
    if (u) candidates.push({ type: 'staff', row: u });
  }
  if (account_type !== 'staff') {
    const s = await studentModel.findByEmailWithHash(email);
    if (s && s.password_hash) candidates.push({ type: 'student', row: s });
  }

  let match = null;
  for (const c of candidates) {
    if (await comparePassword(password, c.row.password_hash)) {
      match = c;
      break;
    }
  }
  if (!candidates.length) await burnComparison(password);
  if (!match) throw new AppError('Invalid credentials.', 401);

  // Account-state checks happen only AFTER the password is proven correct.
  if (match.type === 'staff') {
    if (!match.row.is_active) throw new AppError('This account has been disabled. Contact the administrator.', 403);
    const session = await startSession('staff', match.row.id);
    return { ...session, user: safeStaff(match.row) };
  }

  if (!match.row.email_verified) {
    throw new AppError('Please verify your email with the OTP before logging in.', 403, { code: 'EMAIL_NOT_VERIFIED' });
  }
  const session = await startSession('student', match.row.id);
  return { ...session, user: safeStudent(match.row) };
}

// ----- refresh / logout -----------------------------------------------

/** Rotates the refresh token: the old one dies, a new pair is issued. */
async function refresh(rawToken) {
  const fail = () => new AppError('Session expired. Please log in again.', 401);
  if (!rawToken) throw fail();

  const record = await refreshTokenModel.findByHash(tokenService.hashRefreshToken(rawToken));
  if (!record) throw fail();

  const ownerType = record.user_id ? 'staff' : 'student';
  const ownerId = record.user_id || record.student_id;

  if (record.revoked_at) {
    // An already-used token came back: it may have been stolen. End every session for this account.
    await refreshTokenModel.revokeAllForOwner(ownerType, ownerId);
    throw fail();
  }
  if (Number(record.is_expired)) throw fail();

  if (!(await refreshTokenModel.revokeIfActive(record.id))) throw fail(); // lost a race with another request

  let user;
  if (ownerType === 'staff') {
    const u = await userModel.findPublicById(ownerId);
    if (!u || !u.is_active) throw fail();
    user = safeStaff(u);
  } else {
    const s = await studentModel.findProfileById(ownerId);
    if (!s || !s.email_verified) throw fail();
    user = safeStudent(s);
  }

  const session = await startSession(ownerType, ownerId);
  return { ...session, user };
}

async function logout(rawToken) {
  if (rawToken) await refreshTokenModel.revokeByHash(tokenService.hashRefreshToken(rawToken));
}

module.exports = {
  registerStudent,
  resendRegistrationOtp,
  verifyRegistrationOtp,
  login,
  refresh,
  logout,
  safeStaff,
  safeStudent,
  staffRole,
};
