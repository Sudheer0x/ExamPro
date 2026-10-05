// src/middleware/validation.js — server-side input validation (express-validator).

const { body, query, param, validationResult } = require('express-validator');
const config = require('../config/env');

// ----- shared rules -----------------------------------------------------

const emailRule = () =>
  body('email')
    .isString().withMessage('Email is required.').bail()
    .trim().toLowerCase()
    .isLength({ max: 150 }).withMessage('Email is too long.')
    .isEmail().withMessage('Enter a valid email address.');

// 8–64 chars (bcrypt only reads the first 72 bytes), at least one letter and one number.
const newPasswordRule = () =>
  body('password')
    .isString().withMessage('Password is required.').bail()
    .isLength({ min: 8, max: 64 }).withMessage('Password must be 8 to 64 characters.')
    .matches(/[A-Za-z]/).withMessage('Password must contain at least one letter.')
    .matches(/[0-9]/).withMessage('Password must contain at least one number.');

const otpRule = () =>
  body('otp')
    .isString().withMessage('OTP is required.').bail()
    .trim()
    .matches(new RegExp(`^\\d{${config.otp.length}}$`)).withMessage(`OTP must be ${config.otp.length} digits.`);

// ----- rule sets per endpoint ------------------------------------------

const registerRules = [
  body('full_name')
    .isString().withMessage('Full name is required.').bail()
    .trim()
    .isLength({ min: 2, max: 150 }).withMessage('Full name must be 2 to 150 characters.')
    .matches(/^[\p{L}][\p{L}\s.'-]*$/u).withMessage('Full name contains invalid characters.'),
  emailRule(),
  body('mobile_number')
    .isString().withMessage('Mobile number is required.').bail()
    .customSanitizer((v) => v.replace(/[\s-]/g, ''))
    .matches(/^\+?[0-9]{10,15}$/).withMessage('Enter a valid mobile number (10 to 15 digits).'),
  body('date_of_birth')
    .optional({ values: 'falsy' })
    .isISO8601({ strict: true, strictSeparator: true }).withMessage('Date of birth must be YYYY-MM-DD.').bail()
    .custom((v) => {
      const d = new Date(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error('Date of birth must be YYYY-MM-DD.');
      if (d >= new Date() || d.getFullYear() < 1900) throw new Error('Date of birth is not valid.');
      return true;
    }),
  newPasswordRule(),
];

const emailOnlyRules = [emailRule()];
const verifyOtpRules = [emailRule(), otpRule()];

const loginRules = [
  emailRule(),
  // Login does not re-apply the password policy: just require a sane string.
  body('password').isString().withMessage('Password is required.').bail().isLength({ min: 1, max: 128 }).withMessage('Password is required.'),
  body('account_type').optional().isIn(['student', 'staff']).withMessage("account_type must be 'student' or 'staff'."),
];

const idParamRules = [param('id').isInt({ min: 1, max: 2147483647 }).withMessage('Invalid id.').toInt()];

const listUsersRules = [
  query('page').optional().isInt({ min: 1, max: 100000 }).withMessage('page must be a positive integer.').toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('limit must be between 1 and 100.').toInt(),
  query('role').optional().isIn(['admin', 'teacher', 'invigilator']).withMessage('role must be admin, teacher or invigilator.'),
];

// ----- middleware -------------------------------------------------------

/** Rejects requests whose JSON body contains fields we did not expect. */
function allowOnlyFields(...allowed) {
  const set = new Set(allowed);
  return (req, res, next) => {
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return res.status(400).json({ success: false, message: 'Request body must be a JSON object.' });
    }
    const extra = Object.keys(body).filter((k) => !set.has(k));
    if (extra.length) {
      return res.status(422).json({ success: false, message: `Unexpected field(s): ${extra.join(', ')}` });
    }
    next();
  };
}

/** Put after the rule arrays: turns validation failures into a 422 response. */
function handleValidation(req, res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const errors = result.array().map((e) => ({ field: e.path, message: e.msg }));
  return res.status(422).json({ success: false, message: errors[0].message, errors });
}

module.exports = {
  registerRules,
  emailOnlyRules,
  verifyOtpRules,
  loginRules,
  idParamRules,
  listUsersRules,
  allowOnlyFields,
  handleValidation,
};
