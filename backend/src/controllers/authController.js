// src/controllers/authController.js — HTTP layer only: read the request, call authService, send the response.

const config = require('../config/env');
const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const authService = require('../services/authService');

// The refresh token travels ONLY in this cookie: JavaScript on the page can't read it (HttpOnly),
// it is HTTPS-only in production (Secure), isn't sent from other sites (SameSite), and is sent
// only to /api/auth/* (path), not to every request.
const cookieOptions = () => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  path: '/api/auth',
});

function setRefreshCookie(res, token) {
  res.cookie(config.refresh.cookieName, token, {
    ...cookieOptions(),
    maxAge: config.refresh.days * 24 * 60 * 60 * 1000,
  });
}

const clearRefreshCookie = (res) => res.clearCookie(config.refresh.cookieName, cookieOptions());

const register = asyncHandler(async (req, res) => {
  const { full_name, email, mobile_number, date_of_birth, password } = req.body;
  await authService.registerStudent({ full_name, email, mobile_number, date_of_birth, password });
  sendSuccess(res, 'Registration received. Enter the OTP sent to your email to verify your account.', { email }, 201);
});

const sendOtp = asyncHandler(async (req, res) => {
  await authService.resendRegistrationOtp(req.body.email);
  sendSuccess(res, 'If this email is awaiting verification, a new OTP has been sent.');
});

const verifyOtp = asyncHandler(async (req, res) => {
  await authService.verifyRegistrationOtp({ email: req.body.email, otp: req.body.otp });
  sendSuccess(res, 'Email verified. You can now log in.');
});

const login = asyncHandler(async (req, res) => {
  const { accessToken, refreshToken, user } = await authService.login(req.body);
  setRefreshCookie(res, refreshToken);
  sendSuccess(res, 'Login successful', { accessToken, tokenType: 'Bearer', expiresIn: config.jwt.accessExpiresIn, user });
});

const refresh = asyncHandler(async (req, res) => {
  const raw = req.cookies ? req.cookies[config.refresh.cookieName] : undefined;
  try {
    const { accessToken, refreshToken, user } = await authService.refresh(raw);
    setRefreshCookie(res, refreshToken);
    sendSuccess(res, 'Token refreshed', { accessToken, tokenType: 'Bearer', expiresIn: config.jwt.accessExpiresIn, user });
  } catch (err) {
    if (err instanceof AppError && err.status === 401) clearRefreshCookie(res);
    throw err;
  }
});

const logout = asyncHandler(async (req, res) => {
  const raw = req.cookies ? req.cookies[config.refresh.cookieName] : undefined;
  await authService.logout(raw);
  clearRefreshCookie(res);
  sendSuccess(res, 'Logged out');
});

const me = asyncHandler(async (req, res) => {
  const { id, role, email } = req.user;
  sendSuccess(res, 'OK', { user: { id, role, email } });
});

module.exports = { register, sendOtp, verifyOtp, login, refresh, logout, me };
