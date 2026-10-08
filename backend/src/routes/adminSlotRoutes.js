// src/routes/adminSlotRoutes.js — /api/admin/slots/*  (change or remove one slot)
// Creating and listing slots lives under /api/admin/examinations/:id/slots.
// Mounted by adminRoutes.js AFTER authenticate + authorizeRoles('ADMIN'), so every route here is admin-only.

const express = require('express');
const router = express.Router();

const slots = require('../controllers/slotController');
const rules = require('../middleware/adminValidation');
const { allowOnlyFields, handleValidation } = require('../middleware/validation');
const { adminWriteLimiter } = require('../middleware/rateLimiter');

const id = [rules.idParam('id')];

router.use(adminWriteLimiter);

router.patch('/:id', allowOnlyFields('capacity'), id, rules.slotCapacityRules, handleValidation, slots.updateCapacity);
router.delete('/:id', id, handleValidation, slots.remove);

module.exports = router;
