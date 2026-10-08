// src/routes/adminExaminationRoutes.js — /api/admin/examinations/*
// Mounted by adminRoutes.js AFTER authenticate + authorizeRoles('ADMIN'), so every route here is admin-only.

const express = require('express');
const router = express.Router();

const exams = require('../controllers/examinationController');
const slots = require('../controllers/slotController');
const rules = require('../middleware/adminValidation');
const { allowOnlyFields, handleValidation } = require('../middleware/validation');
const { adminWriteLimiter } = require('../middleware/rateLimiter');

const id = [rules.idParam('id')];

router.use(adminWriteLimiter); // counts changes per admin; reads are free

router.post('/', allowOnlyFields(...rules.examFields), rules.examCreateRules, handleValidation, exams.create);
router.get('/', rules.examListRules, handleValidation, exams.list);
router.get('/:id', id, handleValidation, exams.get);
router.patch('/:id/status', allowOnlyFields('status'), id, rules.examStatusRules, handleValidation, exams.changeStatus);
router.patch('/:id', allowOnlyFields(...rules.examFields), rules.atLeastOne(...rules.examFields), id, rules.examUpdateRules, handleValidation, exams.update);

router.post('/:id/slots', allowOnlyFields('center_id', 'exam_date', 'slot_start_time', 'slot_end_time', 'capacity'), id, rules.slotCreateRules, handleValidation, slots.create);
router.get('/:id/slots', id, rules.slotListRules, handleValidation, slots.list);

module.exports = router;
