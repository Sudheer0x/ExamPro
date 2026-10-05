// src/controllers/invigilatorController.js — Phase 2: just the protected profile.
// The centre / slot / computer / verification workflow belongs to a later phase.

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const userModel = require('../models/userModel');

const getProfile = asyncHandler(async (req, res) => {
  const u = await userModel.findPublicById(req.user.id);
  if (!u) throw new AppError('User not found.', 404);
  sendSuccess(res, 'OK', { id: u.id, full_name: u.full_name, email: u.email, role: 'INVIGILATOR', is_active: Boolean(u.is_active) });
});

module.exports = { getProfile };
