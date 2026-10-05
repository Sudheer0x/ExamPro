// src/middleware/rateLimiter.js — brute-force / spam protection (express-rate-limit).
//
// Each sensitive endpoint gets a per-IP limit, and (where it makes sense) a
// per-email limit as well, so one attacker can't hammer one account from many IPs.
// Counters live in memory: fine for one server process; use a shared store (Redis) if you ever run several.
// For local testing you can set RATE_LIMIT_DISABLED=true in .env (ignored in production).

const rateLimit = require('express-rate-limit');
const config = require('../config/env');

function make({ windowMinutes, max, message, keyGenerator, skipSuccessfulRequests = false }) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests,
    skip: () => config.rateLimitDisabled,
    ...(keyGenerator ? { keyGenerator } : {}),
    handler: (req, res) => res.status(429).json({ success: false, message }),
  });
}

// Key by the email in the request body (falls back to a shared bucket if it's missing/invalid).
const byEmail = (prefix) => (req) => {
  const e = req.body && typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 150) : '';
  return `${prefix}:${e || 'none'}`;
};

const TOO_MANY = 'Too many requests. Please try again later.';

module.exports = {
  registerLimiter: make({ windowMinutes: 60, max: 10, message: 'Too many registration attempts. Try again in an hour.' }),

  loginIpLimiter: make({ windowMinutes: 15, max: 30, message: 'Too many login attempts. Try again in a few minutes.', skipSuccessfulRequests: true }),
  loginEmailLimiter: make({ windowMinutes: 15, max: 5, message: 'Too many failed logins for this account. Try again in 15 minutes.', skipSuccessfulRequests: true, keyGenerator: byEmail('login') }),

  sendOtpIpLimiter: make({ windowMinutes: 60, max: 10, message: 'Too many OTP requests. Try again later.' }),
  sendOtpEmailLimiter: make({ windowMinutes: 60, max: 5, message: 'Too many OTP requests for this email. Try again later.', keyGenerator: byEmail('otp-send') }),

  verifyOtpIpLimiter: make({ windowMinutes: 15, max: 20, message: 'Too many verification attempts. Try again later.' }),
  verifyOtpEmailLimiter: make({ windowMinutes: 15, max: 10, message: 'Too many verification attempts for this email. Try again later.', keyGenerator: byEmail('otp-verify') }),

  refreshLimiter: make({ windowMinutes: 15, max: 60, message: TOO_MANY }),
};
