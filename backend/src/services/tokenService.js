// src/services/tokenService.js
//
//   Access token  : short-lived JWT (default 15 min), sent in the Authorization header.
//                   Holds only the subject id + account type — the ROLE is always
//                   re-read from the database on each request, never from the token.
//   Refresh token : long random string in an HttpOnly cookie. Only its SHA-256 hash is
//                   stored (refresh_tokens table), so it can be rotated and revoked.
//
// A future exam-portal session (Phase 8) should use a different `aud`/`typ`, so
// it can never be confused with a normal login token.

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const refreshTokenModel = require('../models/refreshTokenModel');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

// ownerType: 'staff' (users table) | 'student' (students table)
function signAccessToken(ownerType, ownerId) {
  return jwt.sign({ typ: 'access', st: ownerType }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(ownerId),
    expiresIn: config.jwt.accessExpiresIn,
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

function verifyAccessToken(token) {
  return jwt.verify(token, config.jwt.secret, {
    algorithms: ['HS256'],
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
  });
}

async function createRefreshToken(ownerType, ownerId) {
  const raw = crypto.randomBytes(48).toString('base64url');
  await refreshTokenModel.create({ ownerType, ownerId, tokenHash: sha256(raw), days: config.refresh.days });
  return raw;
}

const hashRefreshToken = sha256;

module.exports = { signAccessToken, verifyAccessToken, createRefreshToken, hashRefreshToken };
