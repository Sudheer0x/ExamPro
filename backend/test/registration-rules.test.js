// Unit tests for the pure registration rules and ID helpers (no database).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { registrationState, canCancel } = require('../src/utils/registrationRules');
const { placeholderCode, buildCodes } = require('../src/utils/registrationIds');

const EXAM = { status: 'registration_open', registration_start_date: '2026-10-01 09:00:00', registration_end_date: '2026-10-31 23:59:59' };

describe('registrationState', () => {
  it('is upcoming before the start, open inside the window, closed from the end onwards', () => {
    assert.equal(registrationState(EXAM, '2026-09-30 23:59:59'), 'upcoming');
    assert.equal(registrationState(EXAM, '2026-10-01 09:00:00'), 'open'); // start is inclusive
    assert.equal(registrationState(EXAM, '2026-10-31 23:59:58'), 'open');
    assert.equal(registrationState(EXAM, '2026-10-31 23:59:59'), 'closed'); // end is exclusive
  });

  it('is closed for any status other than registration_open', () => {
    for (const status of ['registration_closed', 'scheduled', 'draft', 'completed']) {
      assert.equal(registrationState({ ...EXAM, status }, '2026-10-10 10:00:00'), 'closed');
    }
  });
});

describe('canCancel', () => {
  const base = { status: 'completed', examStatus: 'registration_open', registrationEnd: '2026-10-31 23:59:59', slotStart: '2026-12-14 09:00:00', hasPayment: false };
  const NOW = '2026-10-10 10:00:00';

  it('allows cancelling an active registration while registration is open and the slot is ahead', () => {
    assert.equal(canCancel(base, NOW), true);
    assert.equal(canCancel({ ...base, status: 'pending_payment' }, NOW), true);
  });

  it('refuses in every other situation', () => {
    assert.equal(canCancel({ ...base, status: 'cancelled' }, NOW), false);
    assert.equal(canCancel({ ...base, examStatus: 'registration_closed' }, NOW), false);
    assert.equal(canCancel({ ...base, examStatus: 'scheduled' }, NOW), false);
    assert.equal(canCancel(base, '2026-10-31 23:59:59'), false); // registration end reached
    assert.equal(canCancel({ ...base, slotStart: '2026-10-10 10:00:00' }, NOW), false); // slot starting now
    assert.equal(canCancel({ ...base, hasPayment: true }, NOW), false);
  });
});

describe('registration codes', () => {
  it('builds codes from the row id, padded and year-prefixed', () => {
    assert.deepEqual(buildCodes('2026', 42), { registration_id: 'EXP2026000042', application_id: 'APP2026000042' });
    assert.equal(buildCodes('2026', 1234567).registration_id, 'EXP20261234567');
  });

  it('placeholders are unique, fit the VARCHAR(30) column, and never look like real codes', () => {
    const seen = new Set();
    for (let i = 0; i < 1000; i += 1) {
      const code = placeholderCode();
      assert.ok(code.length <= 30);
      assert.ok(code.startsWith('TMP-'));
      seen.add(code);
    }
    assert.equal(seen.size, 1000);
  });
});
