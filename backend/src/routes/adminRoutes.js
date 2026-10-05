// src/routes/adminRoutes.js — /api/admin/*  (ADMIN role only)

const express = require('express');
const router = express.Router();

const c = require('../controllers/adminController');
const { authenticate } = require('../middleware/authentication');
const { authorizeRoles } = require('../middleware/authorization');
const v = require('../middleware/validation');

router.use(authenticate, authorizeRoles('ADMIN'));
router.get('/users', v.listUsersRules, v.handleValidation, c.listUsers);
router.get('/users/:id', v.idParamRules, v.handleValidation, c.getUser);

module.exports = router;
