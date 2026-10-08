// src/controllers/centerController.js — HTTP layer for exam centers and their PCs.

const asyncHandler = require('../utils/asyncHandler');
const { sendSuccess } = require('../utils/apiResponse');
const service = require('../services/centerService');

const create = asyncHandler(async (req, res) => {
  const center = await service.create(req.body);
  sendSuccess(res, 'Exam center created', { center }, 201);
});

const list = asyncHandler(async (req, res) => {
  const data = await service.list({
    page: req.query.page || 1,
    limit: req.query.limit || 20,
    city: req.query.city,
    state: req.query.state,
    is_active: req.query.is_active,
    q: req.query.q,
  });
  sendSuccess(res, 'OK', data);
});

const get = asyncHandler(async (req, res) => {
  sendSuccess(res, 'OK', await service.get(req.params.id));
});

const update = asyncHandler(async (req, res) => {
  const center = await service.update(req.params.id, req.body);
  sendSuccess(res, 'Exam center updated', { center });
});

const remove = asyncHandler(async (req, res) => {
  await service.remove(req.params.id);
  sendSuccess(res, 'Exam center deleted');
});

const bulkCreateComputers = asyncHandler(async (req, res) => {
  const data = await service.bulkCreateComputers(req.params.id, req.body);
  sendSuccess(res, `${data.created} computers created`, data, 201);
});

const listComputers = asyncHandler(async (req, res) => {
  const data = await service.listComputers(req.params.id, {
    page: req.query.page || 1,
    limit: req.query.limit || 50,
    status: req.query.status,
  });
  sendSuccess(res, 'OK', data);
});

const setComputerStatus = asyncHandler(async (req, res) => {
  const data = await service.setComputerStatus(req.params.id, req.params.pcId, req.body.status);
  sendSuccess(res, 'Computer updated', data);
});

const deleteComputer = asyncHandler(async (req, res) => {
  const data = await service.deleteComputer(req.params.id, req.params.pcId);
  sendSuccess(res, 'Computer deleted', data);
});

module.exports = { create, list, get, update, remove, bulkCreateComputers, listComputers, setComputerStatus, deleteComputer };
