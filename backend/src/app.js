// src/app.js
//
// This file builds and configures the Express "app" object, but does NOT
// start listening on a port — that happens in server.js. Keeping them
// separate makes the app easy to import into automated tests later
// without actually opening a network port.

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const helmet = require('helmet');

const config = require('./config/env');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

// Only needed when running behind a reverse proxy / load balancer (so rate limiting sees real client IPs).
if (config.trustProxy) app.set('trust proxy', config.trustProxy === 'true' ? 1 : config.trustProxy);

// ---------- Core middleware ----------
// Security headers. The CSP also allows the Bootstrap CDN the frontend already uses.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'script-src': ["'self'", 'https://cdn.jsdelivr.net'],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        // helmet's default would force http://localhost assets to https and break local development
        'upgrade-insecure-requests': config.isProd ? [] : null,
      },
    },
  })
);

// CORS: only origins listed in CORS_ORIGINS may call the API from a browser (credentials = cookies allowed).
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || config.cors.origins.includes(origin)) return cb(null, true); // no Origin = curl/Postman/same-origin
      return cb(new Error('Not allowed by CORS'));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '10kb' })); // parse application/json request bodies (small limit: auth payloads are tiny)
app.use(express.urlencoded({ extended: true })); // parse HTML form submissions
app.use(cookieParser());
// Request logging: readable colour output while developing, standard Apache-style lines in production,
// and nothing at all during automated tests.
if (config.isProd) app.use(morgan('combined'));
else if (!config.isTest) app.use(morgan('dev'));

// ---------- Static frontend (served for convenience during development) ----------
// Built from __dirname so it works no matter which folder the server is started from.
app.use(express.static(path.join(__dirname, '..', '..', 'frontend')));

// ---------- Health check ----------
// Simple route to confirm the server (and, once added, the database) is up.
// Visit http://localhost:5000/api/health after starting the server.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'ExamPro backend is running.' });
});

// ---------- Feature routes ----------
// Each of these will be filled in during its corresponding phase.
// They are already wired up here so adding real logic later doesn't
// require touching this file again.
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/student', require('./routes/studentRoutes'));
app.use('/api/registration', require('./routes/registrationRoutes'));
app.use('/api/exam', require('./routes/examRoutes'));
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/invigilator', require('./routes/invigilatorRoutes'));
app.use('/api/examiner', require('./routes/examinerRoutes'));

// ---------- 404 + central error handler (see middleware/errorHandler.js) ----------
app.use(notFound);
app.use(errorHandler);

module.exports = app;
