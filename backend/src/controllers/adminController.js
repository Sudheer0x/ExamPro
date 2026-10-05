// src/controllers/adminController.js — Phase 2: only the protected staff-account listing.
// ("users" = the staff table: admin / teacher / invigilator. Student management comes in a later phase.)

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const userModel = require('../models/userModel');

const listUsers = asyncHandler(async (req, res) => {
  const page = req.query.page || 1;
  const limit = req.query.limit || 20;
  const { rows, total } = await userModel.list({ limit, offset: (page - 1) * limit, role: req.query.role });
  sendSuccess(res, 'OK', { users: rows, page, limit, total });
});

const getUser = asyncHandler(async (req, res) => {
  const user = await userModel.findPublicById(req.params.id);
  if (!user) throw new AppError('User not found.', 404);
  sendSuccess(res, 'OK', { user });
});

module.exports = { listUsers, getUser };
