// src/utils/AppError.js
//
// An error we THROW ON PURPOSE (wrong password, duplicate email, ...).
// The central error handler shows its message to the client. Any other kind
// of error (a bug, a SQL failure) is treated as unexpected and hidden in production.

class AppError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.isOperational = true;
    this.extra = extra; // optional extra JSON fields, e.g. { code: 'TOKEN_EXPIRED' }
  }
}

module.exports = AppError;
