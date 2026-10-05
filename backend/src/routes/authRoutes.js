// src/routes/authRoutes.js — /api/auth/*  (routes only: URL + middleware chain + controller)

const express = require('express');
const router = express.Router();

const c = require('../controllers/authController');
const { authenticate } = require('../middleware/authentication');
const v = require('../middleware/validation');
const rl = require('../middleware/rateLimiter');

router.post(
  '/register',
  rl.registerLimiter,
  v.allowOnlyFields('full_name', 'email', 'mobile_number', 'date_of_birth', 'password'),
  v.registerRules, v.handleValidation,
  c.register
);

router.post(
  '/send-otp',
  rl.sendOtpIpLimiter, rl.sendOtpEmailLimiter,
  v.allowOnlyFields('email'),
  v.emailOnlyRules, v.handleValidation,
  c.sendOtp
);

router.post(
  '/verify-otp',
  rl.verifyOtpIpLimiter, rl.verifyOtpEmailLimiter,
  v.allowOnlyFields('email', 'otp'),
  v.verifyOtpRules, v.handleValidation,
  c.verifyOtp
);

router.post(
  '/login',
  rl.loginIpLimiter, rl.loginEmailLimiter,
  v.allowOnlyFields('email', 'password', 'account_type'),
  v.loginRules, v.handleValidation,
  c.login
);

router.post('/refresh', rl.refreshLimiter, c.refresh);
router.post('/logout', c.logout);
router.get('/me', authenticate, c.me);

module.exports = router;
