// src/middleware/studentValidation.js — input rules for the student exam / registration endpoints.
// Use with allowOnlyFields() and handleValidation() from validation.js.

const { body, query, param } = require('express-validator');
const { parseDate } = require('../utils/datetime');

const idParam = (name = 'id') => param(name).isInt({ min: 1, max: 2147483647 }).withMessage(`Invalid ${name}.`).toInt();

const paging = (maxLimit = 50) => [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer.').toInt(),
  query('limit').optional().isInt({ min: 1, max: maxLimit }).withMessage(`limit must be between 1 and ${maxLimit}.`).toInt(),
];

const examListRules = [
  ...paging(50),
  query('q').optional().isString().withMessage('q must be text.').bail().trim().isLength({ max: 100 }).withMessage('q is too long.'),
];

const slotListRules = [
  query('center_id').optional().isInt({ min: 1, max: 2147483647 }).withMessage('center_id must be a positive integer.').toInt(),
  query('date')
    .optional()
    .custom((v) => {
      if (parseDate(v) === null) throw new Error('date must look like 2026-12-14.');
      return true;
    })
    .customSanitizer((v) => parseDate(v)),
];

const mineRules = paging(50);

// slot_id must be a real JSON whole number: "12", 12.5, true and null are all refused.
const registerRules = [
  body('slot_id')
    .custom((v) => {
      if (!Number.isInteger(v) || v < 1 || v > 2147483647) throw new Error('slot_id must be a positive whole number.');
      return true;
    }),
];

module.exports = { idParam, examListRules, slotListRules, mineRules, registerRules };
