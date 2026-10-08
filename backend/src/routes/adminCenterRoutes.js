// src/routes/adminCenterRoutes.js — /api/admin/centers/*  (centers and their computers)
// Mounted by adminRoutes.js AFTER authenticate + authorizeRoles('ADMIN'), so every route here is admin-only.

const express = require('express');
const router = express.Router();

const centers = require('../controllers/centerController');
const rules = require('../middleware/adminValidation');
const { allowOnlyFields, handleValidation } = require('../middleware/validation');
const { adminWriteLimiter, bulkComputersLimiter } = require('../middleware/rateLimiter');

const id = [rules.idParam('id')];
const idAndPc = [rules.idParam('id'), rules.idParam('pcId')];

router.use(adminWriteLimiter);

router.post('/', allowOnlyFields(...rules.centerFields.filter((f) => f !== 'is_active')), rules.centerCreateRules, handleValidation, centers.create);
router.get('/', rules.centerListRules, handleValidation, centers.list);
router.get('/:id', id, handleValidation, centers.get);
router.patch('/:id', allowOnlyFields(...rules.centerFields), rules.atLeastOne(...rules.centerFields), id, rules.centerUpdateRules, handleValidation, centers.update);
router.delete('/:id', id, handleValidation, centers.remove);

router.post('/:id/computers', bulkComputersLimiter, allowOnlyFields('count', 'prefix', 'start_number'), id, rules.computersBulkRules, handleValidation, centers.bulkCreateComputers);
router.get('/:id/computers', id, rules.computersListRules, handleValidation, centers.listComputers);
router.patch('/:id/computers/:pcId', allowOnlyFields('status'), idAndPc, rules.computerStatusRules, handleValidation, centers.setComputerStatus);
router.delete('/:id/computers/:pcId', idAndPc, handleValidation, centers.deleteComputer);

module.exports = router;
