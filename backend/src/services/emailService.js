// src/services/emailService.js
//
// Sends email through SMTP (nodemailer). If SMTP is not configured AND
// NODE_ENV=development, the OTP is printed to the server console instead.
// ***** THAT CONSOLE FALLBACK IS DEVELOPMENT ONLY — it never runs in production. *****

const nodemailer = require('nodemailer');
const config = require('../config/env');
const AppError = require('../utils/AppError');

let transporter = null;
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

async function sendOtpEmail(to, otp, expiryMinutes) {
  if (!config.smtp.configured) {
    if (config.isDev) {
      console.log('\n=============== DEVELOPMENT ONLY — SMTP not configured ===============');
      console.log(`  OTP for ${to}: ${otp}   (valid ${expiryMinutes} min)`);
      console.log('======================================================================\n');
      return;
    }
    throw new AppError('Email service is not available. Please try again later.', 503);
  }

  try {
    await getTransporter().sendMail({
      from: config.smtp.from,
      to,
      subject: 'Your ExamPro verification code',
      text: `Your ExamPro verification code is ${otp}. It expires in ${expiryMinutes} minutes. If you did not request this, ignore this email.`,
    });
  } catch (err) {
    console.error('SMTP send failed:', err.message); // message only: no credentials, no OTP
    throw new AppError('We could not send the verification email. Please try again later.', 502);
  }
}

module.exports = { sendOtpEmail };
