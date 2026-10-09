// utils/errors.js — turns any failure (Axios error, network failure, our own errors) into ONE small,
// safe object the UI can show. Raw Axios errors and server details never reach the screen.

const BY_CODE = {
  REGISTRATION_NOT_OPEN: 'Registration is not open for this examination.',
  REGISTRATION_NOT_STARTED: 'Registration for this examination has not started yet.',
  REGISTRATION_CLOSED: 'Registration for this examination has closed.',
  SLOT_STARTED: 'This slot has already started. Please choose another slot.',
  CENTER_INACTIVE: 'This exam center is no longer available. Please choose another center.',
  SLOT_FULL: 'This slot is full. Please choose another slot.',
  SLOT_NOT_FOUND: 'This slot is no longer available.',
  DUPLICATE_REGISTRATION: 'You are already registered for this examination.',
  REGISTRATION_NOT_FOUND: 'We could not find that registration.',
  ALREADY_CANCELLED: 'This registration has already been cancelled.',
  CANCELLATION_CLOSED: 'Registrations can no longer be cancelled for this examination.',
  PAYMENT_RECEIVED: 'A payment has been received for this registration, so it cannot be cancelled online. Please contact support.',
  ACCOUNT_NOT_ELIGIBLE: 'Your account cannot register for exams.',
  EMAIL_NOT_VERIFIED: 'Please verify your email with the OTP before signing in.',
  TOKEN_EXPIRED: 'Your session has expired. Please sign in again.',
};

const BY_STATUS = {
  400: 'The request could not be understood. Please check your input.',
  401: 'Your session has expired. Please sign in again.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you were looking for.',
  409: 'That conflicts with the current state. Please refresh and try again.',
  422: 'Please correct the highlighted fields and try again.',
  429: 'Too many requests. Please wait a moment and try again.',
};

function build({ status, code = null, message, fieldErrors = {}, retryAfterSeconds = null }) {
  return { isApiError: true, status, code, message, fieldErrors, retryAfterSeconds };
}

/** Always returns { isApiError, status, code, message, fieldErrors, retryAfterSeconds }. */
export function toApiError(error) {
  if (error && error.isApiError) return error;

  const response = error && error.response;
  if (!response) {
    const timedOut = Boolean(error) && error.code === 'ECONNABORTED';
    return build({
      status: 0,
      code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR',
      message: timedOut
        ? 'The server took too long to respond. Please try again.'
        : 'Cannot reach the server. Check your connection and that the backend is running.',
    });
  }

  const status = response.status;
  const body = response.data && typeof response.data === 'object' ? response.data : {};
  const code = typeof body.code === 'string' ? body.code : null;

  let message;
  if (code && BY_CODE[code]) message = BY_CODE[code];
  else if (status >= 500) message = 'Something went wrong on the server. Please try again in a moment.';
  else if (typeof body.message === 'string' && body.message) message = body.message; // the API's 4xx messages are written for users
  else message = BY_STATUS[status] || 'Something went wrong. Please try again.';

  const fieldErrors = {};
  if (Array.isArray(body.errors)) {
    for (const item of body.errors) {
      if (item && item.field && !fieldErrors[item.field]) fieldErrors[item.field] = item.message;
    }
  }

  const retry = Number(body.retryAfterSeconds);
  return build({ status, code, message, fieldErrors, retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : null });
}

/** For code that needs to throw its own friendly error. */
export function makeApiError(message, extra = {}) {
  return build({ status: extra.status ?? 0, code: extra.code ?? null, message, fieldErrors: extra.fieldErrors ?? {} });
}

/** Codes that mean "what you were looking at is out of date — reload it". */
const STALE = new Set(['SLOT_FULL', 'SLOT_STARTED', 'CENTER_INACTIVE', 'SLOT_NOT_FOUND', 'REGISTRATION_NOT_OPEN', 'REGISTRATION_NOT_STARTED', 'REGISTRATION_CLOSED', 'DUPLICATE_REGISTRATION', 'ALREADY_CANCELLED', 'CANCELLATION_CLOSED', 'REGISTRATION_NOT_FOUND']);
export const isStaleDataError = (apiError) => Boolean(apiError && STALE.has(apiError.code));
