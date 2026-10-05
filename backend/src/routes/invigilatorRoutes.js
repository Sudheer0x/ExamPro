// src/routes/invigilatorRoutes.js — /api/invigilator/*  (INVIGILATOR role only)

const express = require('express');
const router = express.Router();

const { getProfile } = require('../controllers/invigilatorController');
const { authenticate } = require('../middleware/authentication');
const { authorizeRoles } = require('../middleware/authorization');

router.use(authenticate, authorizeRoles('INVIGILATOR'));
router.get('/profile', getProfile);

module.exports = router;
