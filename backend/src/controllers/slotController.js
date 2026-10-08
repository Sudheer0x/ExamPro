// src/controllers/slotController.js — HTTP layer for exam slots.

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/slotService');

const create = asyncHandler(async (req, res) => {
  const slot = await service.create(req.params.id, req.body);
  sendSuccess(res, 'Slot created', { slot }, 201);
});

const list = asyncHandler(async (req, res) => {
  sendSuccess(res, 'OK', await service.list(req.params.id, { center_id: req.query.center_id, date: req.query.date }));
});

const updateCapacity = asyncHandler(async (req, res) => {
  const slot = await service.updateCapacity(req.params.id, req.body);
  sendSuccess(res, 'Slot updated', { slot });
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  sendSuccess(res, 'Slot deleted');
});

module.exports = { create, list, updateCapacity, remove };
