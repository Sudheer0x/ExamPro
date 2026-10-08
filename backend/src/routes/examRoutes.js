// src/routes/examRoutes.js — /api/exam/*  (student exam discovery)
//
// The STUDENT guard is applied route by route, NOT to the whole router: later phases will add exam-engine
// routes under this same prefix that use their own exam-session login.

const express = require('express');
const router = express.Router();

const c = require('../controllers/examController');
const { authenticate } = require('../middleware/authentication');
const { authorizeRoles } = require('../middleware/authorization');
const { handleValidation } = require('../middleware/validation');
const rules = require('../middleware/studentValidation');

const studentOnly = [authenticate, authorizeRoles('STUDENT')];

router.get('/', studentOnly, rules.examListRules, handleValidation, c.list);
router.get('/:id', studentOnly, rules.idParam('id'), handleValidation, c.get);
router.get('/:id/slots', studentOnly, rules.idParam('id'), rules.slotListRules, handleValidation, c.slots);

module.exports = router;
