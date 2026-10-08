// src/services/slotCapacity.js
//
// PURE capacity maths (no database): can a slot with N seats fit at a center, given the PCs
// that work and the other slots that run at the same time?
//
// All slots at a center share the SAME physical PCs. So what matters is the busiest moment:
// the most seats in use at any one instant. Two slots that merely touch (one ends at 12:30, the
// next starts at 12:30) never run together. Three slots A 09-11, B 11-13 and C 10-12: C overlaps
// both, but A and B never overlap each other, so the peak is C + the larger of A and B, not A + B + C.
//
// A slot here is { start, end, capacity } with start/end in seconds since midnight (same day).

/**
 * Largest number of seats in use at any instant.
 * With `window` ({start, end}) only the instants inside that window are examined.
 */
function peakLoad(slots, window = null) {
  const instants = new Set();
  if (window) {
    instants.add(window.start);
    for (const s of slots) if (s.start >= window.start && s.start < window.end) instants.add(s.start);
  } else {
    for (const s of slots) instants.add(s.start);
  }

  let peak = 0;
  for (const t of instants) {
    let load = 0;
    for (const s of slots) if (s.start <= t && t < s.end) load += s.capacity;
    if (load > peak) peak = load;
  }
  return peak;
}

/**
 * Decide whether a NEW (or resized) slot fits.
 *   workingComputers : PCs that currently work at the center
 *   requested        : seats wanted by the new slot
 *   overlapping      : the OTHER slots at that center/date whose time overlaps the new one
 *   window           : { start, end } of the new slot
 * Returns { ok, reason, working, requested, existing, available }.
 *   reason: null | 'EXCEEDS_WORKING_PCS' | 'OVERLAP'
 */
function evaluateNewSlot({ workingComputers, requested, overlapping, window }) {
  const existing = peakLoad(overlapping, window);
  const available = Math.max(0, workingComputers - existing);
  const base = { working: workingComputers, requested, existing, available };

  if (requested > workingComputers) return { ok: false, reason: 'EXCEEDS_WORKING_PCS', ...base };
  if (existing + requested > workingComputers) return { ok: false, reason: 'OVERLAP', ...base };
  return { ok: true, reason: null, ...base };
}

/**
 * Busiest instant per calendar day across a set of slots ({ date, start, end, capacity }).
 * Returns { peak, date } for the worst day (peak 0 and date null for no slots).
 */
function worstDay(slots) {
  const byDate = new Map();
  for (const s of slots) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }
  let worst = { peak: 0, date: null };
  for (const [date, list] of byDate) {
    const peak = peakLoad(list);
    if (peak > worst.peak) worst = { peak, date };
  }
  return worst;
}

module.exports = { peakLoad, evaluateNewSlot, worstDay };
