// src/services/otpService.js
//
// OTP rules implemented here:
//   - 6 digits from crypto.randomInt (cryptographically secure)
//   - stored as an HMAC-SHA256 hash, never as plain text
//   - expires after OTP_EXPIRY_MINUTES, usable once, limited attempts
//   - resend cooldown; a new OTP invalidates the previous one

const crypto = require('crypto');
const config = require('../config/env');
const AppError = require('../utils/AppError');
const otpModel = require('../models/otpModel');
const { sendOtpEmail } = require('./emailService');

const PURPOSE_REGISTRATION = 'registration';

function generateOtp() {
  const max = 10 ** config.otp.length;
  return String(crypto.randomInt(0, max)).padStart(config.otp.length, '0');
}

function hashOtp(email, purpose, otp) {
  return crypto.createHmac('sha256', config.otp.hmacSecret).update(`${email}:${purpose}:${otp}`).digest('hex');
}

async function issueOtp(email, purpose = PURPOSE_REGISTRATION) {
  const age = await otpModel.secondsSinceLastOtp(email, purpose);
  if (age !== null && age < config.otp.cooldownSeconds) {
    const wait = config.otp.cooldownSeconds - age;
    throw new AppError(`Please wait ${wait} seconds before requesting another OTP.`, 429, { retryAfterSeconds: wait });
  }

  const otp = generateOtp();
  await otpModel.expireOpenOtps(email, purpose);
  const id = await otpModel.insert({
    email,
    purpose,
    otpHash: hashOtp(email, purpose, otp),
    expiryMinutes: config.otp.expiryMinutes,
  });

  try {
    await sendOtpEmail(email, otp, config.otp.expiryMinutes);
  } catch (err) {
    await otpModel.removeById(id); // email never went out, so don't make the user wait out the cooldown
    throw err;
  }
}

/** Resolves if the OTP is correct (and consumes it). Throws AppError otherwise. */
async function verifyOtp(email, otp, purpose = PURPOSE_REGISTRATION) {
  const invalid = () => new AppError('Invalid or expired OTP.', 400);

  const row = await otpModel.findLatestOpen(email, purpose);
  if (!row) throw invalid();

  const counted = await otpModel.registerAttempt(row.id, config.otp.maxAttempts);
  if (!counted) {
    throw new AppError('Too many incorrect attempts. Please request a new OTP.', 429);
  }

  const expected = Buffer.from(row.otp_code, 'hex');
  const given = Buffer.from(hashOtp(email, purpose, otp), 'hex');
  const matches = expected.length === given.length && crypto.timingSafeEqual(expected, given);
  if (!matches) throw invalid();

  const consumed = await otpModel.consume(row.id);
  if (!consumed) throw invalid(); // someone else used it a moment earlier
}

module.exports = { issueOtp, verifyOtp, PURPOSE_REGISTRATION };
