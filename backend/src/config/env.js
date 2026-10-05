// src/config/env.js
//
// Reads and validates every auth-related setting in ONE place.
// Other files import this instead of touching process.env directly.

require('dotenv').config();
const crypto = require('crypto');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

const jwtSecret = process.env.JWT_SECRET || '';

const config = {
  env,
  isProd,
  isDev: env === 'development',

  jwt: {
    secret: jwtSecret,
    // NOTE: JWT_EXPIRES_IN (2h) in .env.example is reserved for the Phase 8
    // exam-portal token. Normal logins use their own, shorter setting.
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    issuer: 'exampro',
    audience: 'exampro-portal', // a future exam-session token will use a DIFFERENT audience
  },

  refresh: {
    days: num(process.env.REFRESH_TOKEN_DAYS, 7),
    cookieName: 'exampro_refresh',
  },

  otp: {
    length: num(process.env.OTP_LENGTH, 6),
    expiryMinutes: num(process.env.OTP_EXPIRY_MINUTES, 10),
    maxAttempts: num(process.env.OTP_MAX_ATTEMPTS, 5),
    cooldownSeconds: num(process.env.OTP_RESEND_COOLDOWN_SECONDS, 60),
    // Key used to hash OTPs. Falls back to a value derived from JWT_SECRET so the
    // existing .env keeps working; set OTP_HMAC_SECRET to use a separate key.
    hmacSecret:
      process.env.OTP_HMAC_SECRET ||
      crypto.createHash('sha256').update(`otp:${jwtSecret}`).digest('hex'),
  },

  bcryptRounds: 12,

  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:5000,http://localhost:3000,http://127.0.0.1:5000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  // Handy while testing; ignored in production.
  rateLimitDisabled: !isProd && process.env.RATE_LIMIT_DISABLED === 'true',
  trustProxy: process.env.TRUST_PROXY || '',

  smtp: {
    host: process.env.SMTP_HOST,
    port: num(process.env.SMTP_PORT, 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
    from: process.env.EMAIL_FROM || 'ExamPro <no-reply@exampro.com>',
  },
};

// SMTP counts as "configured" only if the values are not the .env.example placeholders.
config.smtp.configured = Boolean(
  config.smtp.host &&
    config.smtp.user &&
    config.smtp.pass &&
    !String(config.smtp.user).startsWith('your_') &&
    !String(config.smtp.pass).startsWith('your_')
);

/** Called once from server.js, before the port opens. */
function validateConfig() {
  const problems = [];
  if (!jwtSecret) problems.push('JWT_SECRET is missing in .env');
  if (isProd) {
    if (jwtSecret.length < 32 || jwtSecret.startsWith('change_this')) {
      problems.push('JWT_SECRET must be a long random string (32+ chars) in production');
    }
    if (!config.smtp.configured) problems.push('SMTP must be configured in production (OTP emails)');
  } else if (jwtSecret.startsWith('change_this')) {
    console.warn('⚠️  JWT_SECRET is still the placeholder from .env.example — fine for local dev, NOT for production.');
  }
  if (problems.length) throw new Error(`Invalid configuration:\n - ${problems.join('\n - ')}`);
}

module.exports = config;
module.exports.validateConfig = validateConfig;
