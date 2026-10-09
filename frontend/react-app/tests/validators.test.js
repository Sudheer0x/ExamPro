import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRegistration, toRegistrationPayload, validateOtp, validateEmail, validatePassword, validateLogin, normalizeMobile } from '../src/utils/validators.js';

const good = { fullName: 'Asha Rao', email: ' Asha@Example.com ', mobile: '98765 43210', dateOfBirth: '2001-05-17', password: 'Passw0rd1', confirmPassword: 'Passw0rd1' };
const TODAY = new Date(Date.UTC(2026, 9, 6));

describe('validators', () => {
  it('accepts a valid registration and builds exactly the body the backend expects', () => {
    assert.deepEqual(validateRegistration(good, TODAY), {});
    assert.deepEqual(toRegistrationPayload(good), {
      full_name: 'Asha Rao', email: 'asha@example.com', mobile_number: '9876543210', password: 'Passw0rd1', date_of_birth: '2001-05-17',
    });
  });

  it('never sends the confirmation password, and omits an empty date of birth', () => {
    const payload = toRegistrationPayload({ ...good, dateOfBirth: '' });
    assert.ok(!('confirmPassword' in payload) && !('confirm_password' in payload) && !('date_of_birth' in payload));
  });

  it('flags each invalid field', () => {
    const errors = validateRegistration({ fullName: 'A', email: 'nope', mobile: '123', dateOfBirth: '2999-01-01', password: 'short', confirmPassword: 'other' }, TODAY);
    assert.deepEqual(Object.keys(errors).sort(), ['dateOfBirth', 'email', 'fullName', 'mobile', 'password', 'confirmPassword'].sort());
  });

  it('requires the confirmation to match', () => {
    assert.equal(validateRegistration({ ...good, confirmPassword: 'Different1' }, TODAY).confirmPassword, 'Passwords do not match.');
    assert.equal(validateRegistration({ ...good, confirmPassword: '' }, TODAY).confirmPassword, 'Please confirm your password.');
  });

  it('applies the same password rules as the backend', () => {
    assert.equal(validatePassword('Passw0rd1'), null);
    for (const bad of ['', 'short1', 'onlyletters', '12345678', 'x'.repeat(65) + '1']) assert.notEqual(validatePassword(bad), null, bad);
  });

  it('checks names, dates and phone numbers', () => {
    assert.equal(validateRegistration({ ...good, fullName: "D'Souza-Rao Jr." }, TODAY).fullName, undefined);
    assert.ok(validateRegistration({ ...good, fullName: '123 Robot' }, TODAY).fullName);
    assert.ok(validateRegistration({ ...good, dateOfBirth: '2001-02-30' }, TODAY).dateOfBirth);
    assert.ok(validateRegistration({ ...good, dateOfBirth: '17-05-2001' }, TODAY).dateOfBirth);
    assert.equal(validateRegistration({ ...good, dateOfBirth: '' }, TODAY).dateOfBirth, undefined);
    assert.equal(validateRegistration({ ...good, mobile: '+91 98765-43210' }, TODAY).mobile, undefined);
    assert.equal(normalizeMobile('+91 98765-43210'), '+919876543210');
  });

  it('validates OTP, email and login input', () => {
    assert.equal(validateOtp('123456'), null);
    assert.equal(validateOtp(' 123456 '), null);
    for (const bad of ['', '12345', '1234567', '12a456']) assert.notEqual(validateOtp(bad), null, bad);
    assert.equal(validateEmail('a@b.co'), null);
    assert.notEqual(validateEmail('a@b'), null);
    assert.deepEqual(validateLogin({ email: 'a@b.co', password: 'x' }), {});
    assert.deepEqual(Object.keys(validateLogin({ email: '', password: '' })).sort(), ['email', 'password']);
  });
});
