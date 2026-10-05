// src/utils/asyncHandler.js
//
// Express 4 does not catch errors thrown inside async handlers by itself.
// Wrapping a handler with this sends any error to the central error handler.

module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
