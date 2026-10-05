// src/middleware/authentication.js
//
// authenticate: checks the "Authorization: Bearer <access token>" header, then
// loads the account from the DATABASE and sets req.user = { id, role, email, type }.
// Role and active-status come from the database, never from the client or the token,
// so disabling a user or changing a role takes effect immediately.

const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const tokenService = require('../services/tokenService');
const userModel = require('../models/userModel');
const studentModel = require('../models/studentModel');

const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw new AppError('Authentication required.', 401);

  let payload;
  try {
    payload = tokenService.verifyAccessToken(token);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw new AppError('Access token expired.', 401, { code: 'TOKEN_EXPIRED' });
    }
    throw new AppError('Invalid authentication token.', 401);
  }

  if (payload.typ !== 'access' || !['staff', 'student'].includes(payload.st)) {
    throw new AppError('Invalid authentication token.', 401);
  }

  const id = Number(payload.sub);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Invalid authentication token.', 401);

  if (payload.st === 'staff') {
    const user = await userModel.findAuthById(id);
    if (!user || !user.is_active) throw new AppError('Account is not available.', 401);
    req.user = { id: user.id, role: String(user.role).toUpperCase(), email: user.email, type: 'staff' };
  } else {
    const student = await studentModel.findAuthById(id);
    if (!student || !student.email_verified) throw new AppError('Account is not available.', 401);
    req.user = { id: student.id, role: 'STUDENT', email: student.email, type: 'student' };
  }

  next();
});

module.exports = { authenticate };
