import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toApiError, makeApiError, isStaleDataError } from '../src/utils/errors.js';

const axiosError = (status, data) => ({ isAxiosError: true, response: { status, data } });

describe('toApiError', () => {
  it('uses friendly text for known registration codes', () => {
    for (const [code, fragment] of [['SLOT_FULL', 'full'], ['DUPLICATE_REGISTRATION', 'already registered'], ['CANCELLATION_CLOSED', 'no longer be cancelled'], ['PAYMENT_RECEIVED', 'payment has been received']]) {
      const e = toApiError(axiosError(409, { success: false, message: 'raw backend text', code }));
      assert.equal(e.code, code);
      assert.ok(e.message.toLowerCase().includes(fragment), `${code}: ${e.message}`);
      assert.notEqual(e.message, 'raw backend text');
    }
  });

  it('passes the backend message through for other 4xx errors', () => {
    const e = toApiError(axiosError(409, { success: false, message: 'An account with this email already exists.' }));
    assert.equal(e.status, 409);
    assert.equal(e.message, 'An account with this email already exists.');
  });

  it('collects field errors from validation responses (422)', () => {
    const e = toApiError(axiosError(422, { success: false, message: 'Enter a valid email address.', errors: [{ field: 'email', message: 'Enter a valid email address.' }, { field: 'email', message: 'second' }, { field: 'password', message: 'Too short' }] }));
    assert.deepEqual(e.fieldErrors, { email: 'Enter a valid email address.', password: 'Too short' });
  });

  it('never shows server internals for 5xx errors', () => {
    const e = toApiError(axiosError(500, { success: false, message: 'ER_BAD_FIELD_ERROR at /srv/app/secret.js:12' }));
    assert.equal(e.message, 'Something went wrong on the server. Please try again in a moment.');
  });

  it('describes network failures and timeouts', () => {
    assert.equal(toApiError(new Error('Network Error')).code, 'NETWORK_ERROR');
    assert.equal(toApiError({ code: 'ECONNABORTED' }).code, 'TIMEOUT');
    assert.equal(toApiError(undefined).code, 'NETWORK_ERROR');
  });

  it('keeps the retry-after hint for rate limits and falls back gracefully on odd bodies', () => {
    assert.equal(toApiError(axiosError(429, { message: 'Please wait 42 seconds', retryAfterSeconds: 42 })).retryAfterSeconds, 42);
    assert.equal(toApiError(axiosError(404, '<html>not json</html>')).message, 'We could not find what you were looking for.');
    assert.equal(toApiError(axiosError(418, null)).message, 'Something went wrong. Please try again.');
  });

  it('is idempotent and flags stale-data codes', () => {
    const once = toApiError(axiosError(409, { code: 'SLOT_FULL' }));
    assert.equal(toApiError(once), once);
    assert.equal(isStaleDataError(once), true);
    assert.equal(isStaleDataError(makeApiError('x')), false);
    assert.equal(isStaleDataError(null), false);
  });
});
