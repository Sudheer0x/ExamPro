// src/controllers/studentController.js
// Students only ever see THEIR OWN record: the id comes from req.user (set by the server), never from the URL.

const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/AppError');
const { sendSuccess } = require('../utils/apiResponse');
const studentModel = require('../models/studentModel');

const getProfile = asyncHandler(async (req, res) => {
  const s = await studentModel.findProfileById(req.user.id);
  if (!s) throw new AppError('Student not found.', 404);
  sendSuccess(res, 'OK', {
    id: s.id,
    full_name: s.full_name,
    email: s.email,
    phone: s.mobile_number,
    email_verified: Boolean(s.email_verified),
    // The students table has no separate "status" column yet. Only verified students can
    // authenticate at all, so a student who reaches this endpoint is ACTIVE.
    account_status: s.email_verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
  });
});

module.exports = { getProfile };
