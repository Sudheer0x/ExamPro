// Pure-function tests for the display helpers. Run with:  node --test "tests/*.test.js"   (no extra packages)
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDate, formatTime, formatDateTime, formatFee, formatDuration, isFree, homePathFor, roleLabel, formatTimeRange } from '../src/utils/format.js';

describe('format', () => {
  it('formats dates and times without any time-zone conversion', () => {
    assert.equal(formatDate('2026-12-14'), '14 Dec 2026');
    assert.equal(formatDate('2026-01-05 09:00:00'), '5 Jan 2026');
    assert.equal(formatTime('09:00:00'), '09:00 AM');
    assert.equal(formatTime('12:30:00'), '12:30 PM');
    assert.equal(formatTime('00:15:00'), '12:15 AM');
    assert.equal(formatTime('23:59:59'), '11:59 PM');
    assert.equal(formatDateTime('2026-10-01 09:00:00'), '1 Oct 2026, 09:00 AM');
    assert.equal(formatDateTime('2026-10-31T23:59:59'), '31 Oct 2026, 11:59 PM');
    assert.equal(formatTimeRange('09:00:00', '12:30:00'), '09:00 AM – 12:30 PM');
  });

  it('shows a dash for missing values and leaves odd values readable', () => {
    for (const fn of [formatDate, formatTime, formatDateTime]) {
      assert.equal(fn(null), '—');
      assert.equal(fn(undefined), '—');
    }
    assert.equal(formatDate('soon'), 'soon');
  });

  it('formats fees and durations', () => {
    assert.equal(formatFee('0.00'), 'Free');
    assert.equal(formatFee(0), 'Free');
    assert.equal(formatFee('500.00'), '500.00');
    assert.equal(formatFee('499.5'), '499.50');
    assert.equal(formatFee('abc'), '—');
    assert.equal(isFree('0.00'), true);
    assert.equal(isFree('10.00'), false);
    assert.equal(formatDuration(180), '3 h');
    assert.equal(formatDuration(90), '1 h 30 min');
    assert.equal(formatDuration(45), '45 min');
    assert.equal(formatDuration(0), '—');
  });

  it('maps roles to labels and landing pages', () => {
    assert.equal(roleLabel('ADMIN'), 'Administrator');
    assert.equal(homePathFor('STUDENT'), '/student/dashboard');
    assert.equal(homePathFor('ADMIN'), '/admin/dashboard');
    assert.equal(homePathFor('TEACHER'), '/unauthorized');
    assert.equal(homePathFor(undefined), '/unauthorized');
  });
});
