// Unit tests for the strict date/time parsers (no database, no network).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDate, parseTime, parseDateTime, timeToSeconds } = require('../src/utils/datetime');

describe('datetime parsers', () => {
  it('parseDate accepts real calendar dates only', () => {
    assert.equal(parseDate('2026-12-14'), '2026-12-14');
    assert.equal(parseDate(' 2028-02-29 '), '2028-02-29'); // leap day
    for (const bad of ['2026-02-30', '2027-02-29', '2026-13-01', '14-12-2026', '2026-1-1', '2026-12-14T00:00', '', null, undefined, 20261214]) {
      assert.equal(parseDate(bad), null, `should reject ${String(bad)}`);
    }
  });

  it('parseTime accepts HH:MM and HH:MM:SS and normalises', () => {
    assert.equal(parseTime('09:00'), '09:00:00');
    assert.equal(parseTime('23:59:59'), '23:59:59');
    for (const bad of ['24:00', '9:00', '09:60', '09:00:60', '09', 'noon', '', null]) {
      assert.equal(parseTime(bad), null, `should reject ${String(bad)}`);
    }
  });

  it('parseDateTime accepts a space or T and rejects offsets / Z', () => {
    assert.equal(parseDateTime('2026-12-14 09:00:00'), '2026-12-14 09:00:00');
    assert.equal(parseDateTime('2026-12-14T09:00'), '2026-12-14 09:00:00');
    for (const bad of ['2026-12-14T09:00:00Z', '2026-12-14 09:00:00+05:30', '2026-02-30 09:00:00', '2026-12-14', '2026-12-14 25:00:00', '']) {
      assert.equal(parseDateTime(bad), null, `should reject ${String(bad)}`);
    }
  });

  it('timeToSeconds converts HH:MM:SS', () => {
    assert.equal(timeToSeconds('00:00:00'), 0);
    assert.equal(timeToSeconds('09:30:15'), 9 * 3600 + 30 * 60 + 15);
  });
});
