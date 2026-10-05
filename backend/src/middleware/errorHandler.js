// src/middleware/errorHandler.js — 404 + one central error handler for the whole API.

const config = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Route not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Known, deliberate errors (AppError): safe to show their message.
  if (err.isOperational) {
    return res.status(err.status).json({ success: false, message: err.message, ...err.extra });
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Malformed JSON in request body.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: 'Request body too large.' });
  }
  // Blocked by our CORS allow-list
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, message: 'Origin not allowed.' });
  }

  // Anything else is a bug or a database failure: log it here, hide the details from the client.
  console.error(`Unexpected error on ${req.method} ${req.path}:`, config.isProd ? err.message : err.stack);
  res.status(500).json({ success: false, message: 'Something went wrong on the server.' });
}

module.exports = { notFound, errorHandler };
