// src/controllers/registrationController.js — a student registers, lists their registrations, cancels.
// The student is ALWAYS req.user (set by authenticate); a student_id in the request is rejected upstream.

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/registrationService');

const create = asyncHandler(async (req, res) => {
  const registration = await service.register(req.user.id, req.body.slot_id);
  sendSuccess(res, 'Registration successful', { registration }, 201);
});

const mine = asyncHandler(async (req, res) => {
  const data = await service.listMine(req.user.id, { page: req.query.page || 1, limit: req.query.limit || 20 });
  sendSuccess(res, 'OK', data);
});

const cancel = asyncHandler(async (req, res) => {
  const registration = await service.cancel(req.user.id, req.params.id);
  sendSuccess(res, 'Registration cancelled', { registration });
});

module.exports = { create, mine, cancel };
