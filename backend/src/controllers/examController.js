// src/controllers/examController.js — student exam discovery: list, details, slots.
// (Student-only; the student's id is taken from the verified login, never from the request.)

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/catalogService');

const list = asyncHandler(async (req, res) => {
  const data = await service.listExams({ page: req.query.page || 1, limit: req.query.limit || 20, q: req.query.q });
  sendSuccess(res, 'OK', data);
});

const get = asyncHandler(async (req, res) => {
  sendSuccess(res, 'OK', await service.getExam(req.user.id, req.params.id));
});

const slots = asyncHandler(async (req, res) => {
  sendSuccess(res, 'OK', await service.listSlots(req.params.id, { center_id: req.query.center_id, date: req.query.date }));
});

module.exports = { list, get, slots };
