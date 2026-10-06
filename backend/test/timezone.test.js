// Unit tests for the DB_TIME_ZONE offset parser (no database, no network).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseOffsetMinutes } = require('../src/utils/timezone');

describe('parseOffsetMinutes', () => {
  it('parses valid offsets into minutes', () => {
    assert.equal(parseOffsetMinutes('+05:30'), 330);
    assert.equal(parseOffsetMinutes('-08:00'), -480);
    assert.equal(parseOffsetMinutes('+00:00'), 0);
    assert.equal(parseOffsetMinutes('+14:00'), 840);
  });

  it('rejects zone names and malformed or out-of-range values', () => {
    for (const bad of ['Asia/Kolkata', 'IST', '+5:30', '0530', '+05:60', '+14:30', '-14:00', '+15:00', '', undefined, null]) {
      assert.equal(parseOffsetMinutes(bad), null, `should reject ${String(bad)}`);
    }
  });
});
