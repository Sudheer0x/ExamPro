// src/routes/registrationRoutes.js — /api/registration/*  (student registration)
// Every route is STUDENT-only. Admin, invigilator and teacher accounts get 403.

const express = require('express');
const router = express.Router();

const c = require('../controllers/registrationController');
const { authenticate } = require('../middleware/authentication');
const { authorizeRoles } = require('../middleware/authorization');
const { allowOnlyFields, handleValidation } = require('../middleware/validation');
const { registrationCreateLimiter, registrationCancelLimiter } = require('../middleware/rateLimiter');
const rules = require('../middleware/studentValidation');

const studentOnly = [authenticate, authorizeRoles('STUDENT')];

router.get('/mine', studentOnly, rules.mineRules, handleValidation, c.mine);

// allowOnlyFields('slot_id') is what rejects a student_id (or anything else) sent by the client.
router.post('/', studentOnly, registrationCreateLimiter, allowOnlyFields('slot_id'), rules.registerRules, handleValidation, c.create);

router.delete('/:id', studentOnly, registrationCancelLimiter, rules.idParam('id'), handleValidation, c.cancel);

module.exports = router;
