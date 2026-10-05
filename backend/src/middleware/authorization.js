// src/middleware/authorization.js
//
// authorizeRoles('ADMIN')  or  authorizeRoles('ADMIN', 'INVIGILATOR')
// Always place it AFTER `authenticate`. Wrong role -> 403.
// Roles: STUDENT, ADMIN, INVIGILATOR, TEACHER (teacher = the "examiner" role in the users table).

const AppError = require('../utils/AppError');

function authorizeRoles(...allowed) {
  const allowedSet = new Set(allowed.map((r) => String(r).toUpperCase()));
  return (req, res, next) => {
    if (!req.user) return next(new AppError('Authentication required.', 401));
    if (!allowedSet.has(req.user.role)) {
      return next(new AppError('You do not have permission to access this resource.', 403));
    }
    next();
  };
}

module.exports = { authorizeRoles };
