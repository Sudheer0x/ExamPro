// src/routes/studentRoutes.js — /api/student/*  (STUDENT role only)

const express = require('express');
const router = express.Router();

const { getProfile } = require('../controllers/studentController');
const { authenticate } = require('../middleware/authentication');
const { authorizeRoles } = require('../middleware/authorization');

router.use(authenticate, authorizeRoles('STUDENT'));
router.get('/profile', getProfile);

module.exports = router;
