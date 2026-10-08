// Unit tests for the pure slot-capacity maths (no database).
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { peakLoad, evaluateNewSlot, worstDay } = require('../src/services/slotCapacity');

const H = 3600;
const slot = (startH, endH, capacity) => ({ start: startH * H, end: endH * H, capacity });

describe('peakLoad', () => {
  it('is 0 with no slots', () => assert.equal(peakLoad([]), 0));

  it('sums slots that run at the same time', () => {
    assert.equal(peakLoad([slot(9, 12, 40), slot(10, 13, 30)]), 70);
  });

  it('does not add slots that only touch', () => {
    assert.equal(peakLoad([slot(9, 12, 40), slot(12, 15, 30)]), 40);
  });

  it('uses the busiest instant, not the sum of everything (A 9-11, B 11-13, C 10-12)', () => {
    const a = slot(9, 11, 30);
    const b = slot(11, 13, 50);
    const c = slot(10, 12, 20);
    assert.equal(peakLoad([a, b, c]), 70); // at 11:00 B + C run together; A and B never do
  });

  it('with a window only looks inside it', () => {
    const others = [slot(8, 10, 60), slot(14, 16, 60)];
    assert.equal(peakLoad(others, { start: 10 * H, end: 14 * H }), 0); // touches both ends, overlaps neither
    assert.equal(peakLoad(others, { start: 9 * H, end: 15 * H }), 60);
  });
});

describe('evaluateNewSlot', () => {
  it('accepts a slot that fits next to an overlapping one', () => {
    const r = evaluateNewSlot({ workingComputers: 60, requested: 20, overlapping: [slot(9, 12, 40)], window: { start: 11 * H, end: 14 * H } });
    assert.equal(r.ok, true);
    assert.equal(r.available, 20);
  });

  it('rejects when the overlap would exceed the working PCs', () => {
    const r = evaluateNewSlot({ workingComputers: 60, requested: 30, overlapping: [slot(9, 12, 40)], window: { start: 11 * H, end: 14 * H } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'OVERLAP');
    assert.deepEqual([r.working, r.existing, r.requested, r.available], [60, 40, 30, 20]);
  });

  it('rejects more seats than working PCs even with nothing else running', () => {
    const r = evaluateNewSlot({ workingComputers: 60, requested: 61, overlapping: [], window: { start: 9 * H, end: 12 * H } });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'EXCEEDS_WORKING_PCS');
  });

  it('allows exactly filling the center', () => {
    assert.equal(evaluateNewSlot({ workingComputers: 60, requested: 60, overlapping: [], window: { start: 0, end: H } }).ok, true);
    assert.equal(evaluateNewSlot({ workingComputers: 60, requested: 20, overlapping: [slot(9, 12, 40)], window: { start: 10 * H, end: 11 * H } }).ok, true);
  });

  it('a slot that starts exactly when another ends is not an overlap', () => {
    const r = evaluateNewSlot({ workingComputers: 60, requested: 60, overlapping: [], window: { start: 12 * H, end: 15 * H } });
    assert.equal(r.ok, true);
  });

  it('zero working PCs rejects everything', () => {
    assert.equal(evaluateNewSlot({ workingComputers: 0, requested: 1, overlapping: [], window: { start: 0, end: H } }).ok, false);
  });
});

describe('worstDay', () => {
  it('finds the busiest day', () => {
    const slots = [
      { date: '2026-12-14', ...slot(9, 12, 40) },
      { date: '2026-12-14', ...slot(10, 13, 30) },
      { date: '2026-12-15', ...slot(9, 12, 50) },
    ];
    assert.deepEqual(worstDay(slots), { peak: 70, date: '2026-12-14' });
  });

  it('returns peak 0 for no slots', () => assert.deepEqual(worstDay([]), { peak: 0, date: null }));
});
