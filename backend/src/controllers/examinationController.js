// src/controllers/examinationController.js — HTTP layer for admin examination management.
// (The older examController.js stub is reserved for the future exam engine and is not touched.)

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/examinationService');

const create = asyncHandler(async (req, res) => {
  const examination = await service.create(req.body);
  sendSuccess(res, 'Examination created', { examination }, 201);
});

const list = asyncHandler(async (req, res) => {
  const data = await service.list({
    page: req.query.page || 1,
    limit: req.query.limit || 20,
    status: req.query.status,
    q: req.query.q,
  });
  sendSuccess(res, 'OK', data);
});

const get = asyncHandler(async (req, res) => {
  sendSuccess(res, 'OK', await service.get(req.params.id));
});

const update = asyncHandler(async (req, res) => {
  const examination = await service.update(req.params.id, req.body);
  sendSuccess(res, 'Examination updated', { examination });
});

const changeStatus = asyncHandler(async (req, res) => {
  const examination = await service.changeStatus(req.params.id, req.body.status);
  sendSuccess(res, `Examination is now ${examination.status}`, { examination });
});

module.exports = { create, list, get, update, changeStatus };
