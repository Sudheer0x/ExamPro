// src/middleware/adminValidation.js — input rules for the Phase 3B admin endpoints (express-validator).
// Use together with allowOnlyFields() and handleValidation() from validation.js:
//   router.post('/', allowOnlyFields('a', 'b'), rules.something, handleValidation, controller)
//
// Dates and times are BUSINESS time with no offset: '2026-12-14', '09:00' or '09:00:00',
// '2026-12-14 09:00:00' (a 'T' instead of the space is also accepted). They are normalised here,
// so the services always receive 'YYYY-MM-DD', 'HH:MM:SS' and 'YYYY-MM-DD HH:MM:SS'.

const { body, query, param } = require('express-validator');
const config = require('../config/env');
const { parseDate, parseTime, parseDateTime } = require('../utils/datetime');

const EXAM_STATUSES = ['draft', 'registration_open', 'registration_closed', 'scheduled', 'completed'];
const PC_STATUSES = ['available', 'allocated', 'maintenance'];

// ---------- small builders ----------

const idParam = (name = 'id') =>
  param(name).isInt({ min: 1, max: 2147483647 }).withMessage(`Invalid ${name}.`).toInt();

function text(field, label, { min = 1, max, optional = false, nullable = false } = {}) {
  const chain = body(field);
  if (optional) chain.optional({ values: nullable ? 'null' : 'undefined' });
  chain
    .isString().withMessage(`${label} must be text.`).bail()
    .trim()
    .isLength({ min, max }).withMessage(`${label} must be ${min === 0 ? 'at most' : `${min} to`} ${max} characters.`);
  if (nullable) chain.customSanitizer((v) => (v === '' ? null : v));
  return chain;
}

function integer(field, label, { min, max, optional = false }) {
  const chain = body(field);
  if (optional) chain.optional();
  return chain.isInt({ min, max }).withMessage(`${label} must be a whole number from ${min} to ${max}.`).toInt();
}

function dateTime(field, label, { optional = false } = {}) {
  const chain = body(field);
  if (optional) chain.optional();
  return chain
    .custom((v) => {
      if (parseDateTime(v) === null) throw new Error(`${label} must look like 2026-12-14 09:00:00.`);
      return true;
    })
    .customSanitizer((v) => parseDateTime(v));
}

function dateOnly(field, label) {
  return body(field)
    .custom((v) => {
      if (parseDate(v) === null) throw new Error(`${label} must look like 2026-12-14.`);
      return true;
    })
    .customSanitizer((v) => parseDate(v));
}

function timeOnly(field, label) {
  return body(field)
    .custom((v) => {
      if (parseTime(v) === null) throw new Error(`${label} must look like 09:00 or 09:00:00.`);
      return true;
    })
    .customSanitizer((v) => parseTime(v));
}

const paging = (defaultMax = 100) => [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer.').toInt(),
  query('limit').optional().isInt({ min: 1, max: defaultMax }).withMessage(`limit must be between 1 and ${defaultMax}.`).toInt(),
];

const searchText = (name, max = 100) =>
  query(name).optional().isString().withMessage(`${name} must be text.`).bail().trim().isLength({ max }).withMessage(`${name} is too long.`);

function fee(optional = true) {
  const chain = body('fee');
  if (optional) chain.optional();
  return chain
    .custom((v) => {
      const ok = (typeof v === 'number' || typeof v === 'string') && /^\d{1,8}(\.\d{1,2})?$/.test(String(v));
      if (!ok) throw new Error('fee must be an amount like 500 or 500.00 (at most 2 decimals, not negative).');
      return true;
    })
    .customSanitizer((v) => Number(v).toFixed(2));
}

/** For PATCH: the body must contain at least one of the listed fields. */
const atLeastOne = (...fields) => (req, res, next) => {
  if (fields.some((f) => req.body[f] !== undefined)) return next();
  return res.status(422).json({ success: false, message: `Provide at least one of: ${fields.join(', ')}.` });
};

// ---------- examinations ----------

const examFields = ['exam_name', 'description', 'instructions', 'registration_start_date', 'registration_end_date', 'exam_duration_minutes', 'fee'];

const examCreateRules = [
  text('exam_name', 'exam_name', { min: 3, max: 200 }),
  text('description', 'description', { min: 0, max: 4000, optional: true, nullable: true }),
  text('instructions', 'instructions', { min: 0, max: 4000, optional: true, nullable: true }),
  dateTime('registration_start_date', 'registration_start_date'),
  dateTime('registration_end_date', 'registration_end_date'),
  integer('exam_duration_minutes', 'exam_duration_minutes', { min: 1, max: 600 }),
  fee(true),
];

const examUpdateRules = [
  text('exam_name', 'exam_name', { min: 3, max: 200, optional: true }),
  text('description', 'description', { min: 0, max: 4000, optional: true, nullable: true }),
  text('instructions', 'instructions', { min: 0, max: 4000, optional: true, nullable: true }),
  dateTime('registration_start_date', 'registration_start_date', { optional: true }),
  dateTime('registration_end_date', 'registration_end_date', { optional: true }),
  integer('exam_duration_minutes', 'exam_duration_minutes', { min: 1, max: 600, optional: true }),
  fee(true),
];

const examStatusRules = [body('status').isIn(EXAM_STATUSES).withMessage(`status must be one of: ${EXAM_STATUSES.join(', ')}.`)];

const examListRules = [
  ...paging(100),
  query('status').optional().isIn(EXAM_STATUSES).withMessage(`status must be one of: ${EXAM_STATUSES.join(', ')}.`),
  searchText('q'),
];

// ---------- centers and computers ----------

const centerFields = ['center_name', 'address', 'city', 'state', 'is_active'];

const centerCreateRules = [
  text('center_name', 'center_name', { min: 2, max: 150 }),
  text('address', 'address', { min: 0, max: 500, optional: true, nullable: true }),
  text('city', 'city', { min: 2, max: 100 }),
  text('state', 'state', { min: 2, max: 100 }),
];

const centerUpdateRules = [
  text('center_name', 'center_name', { min: 2, max: 150, optional: true }),
  text('address', 'address', { min: 0, max: 500, optional: true, nullable: true }),
  text('city', 'city', { min: 2, max: 100, optional: true }),
  text('state', 'state', { min: 2, max: 100, optional: true }),
  body('is_active').optional().isBoolean().withMessage('is_active must be true or false.').toBoolean(),
];

const centerListRules = [
  ...paging(100),
  searchText('city'),
  searchText('state'),
  searchText('q'),
  query('is_active').optional().isBoolean().withMessage('is_active must be true or false.').toBoolean(),
];

const computersBulkRules = [
  integer('count', 'count', { min: 1, max: config.limits.maxPcsPerRequest }),
  body('prefix')
    .optional()
    .isString().withMessage('prefix must be text.').bail()
    .matches(/^[A-Za-z0-9-]{0,10}$/).withMessage('prefix can have up to 10 letters, digits or dashes.'),
  integer('start_number', 'start_number', { min: 1, max: 99999, optional: true }),
];

const computersListRules = [
  ...paging(200),
  query('status').optional().isIn(PC_STATUSES).withMessage(`status must be one of: ${PC_STATUSES.join(', ')}.`),
];

const computerStatusRules = [body('status').isIn(['available', 'maintenance']).withMessage("status must be 'available' or 'maintenance'.")];

// ---------- slots ----------

const slotCreateRules = [
  integer('center_id', 'center_id', { min: 1, max: 2147483647 }),
  dateOnly('exam_date', 'exam_date'),
  timeOnly('slot_start_time', 'slot_start_time'),
  timeOnly('slot_end_time', 'slot_end_time'),
  integer('capacity', 'capacity', { min: 1, max: 5000 }),
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

const slotCapacityRules = [integer('capacity', 'capacity', { min: 1, max: 5000 })];

module.exports = {
  idParam,
  atLeastOne,
  examFields, examCreateRules, examUpdateRules, examStatusRules, examListRules,
  centerFields, centerCreateRules, centerUpdateRules, centerListRules,
  computersBulkRules, computersListRules, computerStatusRules,
  slotCreateRules, slotListRules, slotCapacityRules,
};
