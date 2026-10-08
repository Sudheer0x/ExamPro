// src/services/slotService.js — exam slots (admin side).
//
// Locks are always taken in the same order: examination, then center, then slot. That keeps two
// admins from deadlocking each other, and (because the center row is locked) makes the capacity
// check race-free: two admins can never both squeeze the last PCs into different slots.
//
// All slots at a center share its physical PCs, so capacity is checked against the busiest moment
// (see slotCapacity.js), not just against the PC count.

const config = require('../config/env');
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/transaction');
const { timeToSeconds } = require('../utils/datetime');
const { evaluateNewSlot } = require('./slotCapacity');
const examinationModel = require('../models/examinationModel');
const centerModel = require('../models/centerModel');
const computerModel = require('../models/computerModel');
const slotModel = require('../models/slotModel');
const clockModel = require('../models/clockModel');

const ADD_SLOT_STATUSES = new Set(['draft', 'registration_open', 'registration_closed']);

const notFound = (what = 'Slot') => new AppError(`${what} not found.`, 404);
const conflict = (message, code, details) => new AppError(message, 409, { code, ...(details ? { details } : {}) });
const invalid = (message, code, details) => new AppError(message, 422, { code, ...(details ? { details } : {}) });

function serialize(row) {
  const capacity = Number(row.capacity);
  const booked = Number(row.booked_count || 0);
  return {
    id: row.id,
    examination_id: row.examination_id,
    center_id: row.center_id,
    center_name: row.center_name,
    city: row.city,
    exam_date: row.exam_date,
    slot_start_time: row.slot_start_time,
    slot_end_time: row.slot_end_time,
    capacity,
    booked_count: booked,
    seats_left: Math.max(0, capacity - booked),
    created_at: row.created_at,
    timezone: config.db.timeZone,
  };
}

const toOverlapSlot = (s) => ({ start: timeToSeconds(s.slot_start_time), end: timeToSeconds(s.slot_end_time), capacity: Number(s.capacity) });

/** Throws CAPACITY_EXCEEDED unless `requested` seats fit at the center during [start, end). */
async function assertFits({ centerId, date, start, end, requested, excludeId }, conn) {
  const counts = await computerModel.countByCenter(centerId, conn);
  const others = await slotModel.listOverlapping({ centerId, date, start, end, excludeId }, conn);
  const verdict = evaluateNewSlot({
    workingComputers: counts.working,
    requested,
    overlapping: others.map(toOverlapSlot),
    window: { start: timeToSeconds(start), end: timeToSeconds(end) },
  });
  if (verdict.ok) return;

  const details = {
    working_computers: verdict.working,
    overlapping_capacity: verdict.existing,
    requested: verdict.requested,
    available: verdict.available,
  };
  const message =
    verdict.reason === 'EXCEEDS_WORKING_PCS'
      ? `This center has only ${verdict.working} working PCs; a slot cannot have more seats than that.`
      : `Capacity exceeds the working PCs at this center for that time: ${verdict.working} working PCs, ${verdict.existing} already used by overlapping slots, ${verdict.available} left.`;
  throw conflict(message, 'CAPACITY_EXCEEDED', details);
}

async function create(examinationId, input) {
  return withTransaction(async (conn) => {
    const exam = await examinationModel.lockById(examinationId, conn);
    if (!exam) throw notFound('Examination');
    if (!ADD_SLOT_STATUSES.has(exam.status)) {
      throw conflict(`Slots cannot be added to an examination that is ${exam.status}.`, 'EXAM_LOCKED');
    }

    const center = await centerModel.lockById(input.center_id, conn);
    if (!center) throw invalid('That exam center does not exist.', 'CENTER_NOT_FOUND');
    const centerRow = await centerModel.findById(input.center_id, conn);
    if (!centerRow.is_active) throw conflict('That exam center is deactivated.', 'CENTER_INACTIVE');

    const { exam_date: date, slot_start_time: start, slot_end_time: end, capacity } = input;
    if (!(timeToSeconds(end) > timeToSeconds(start))) throw invalid('The slot must end after it starts.', 'INVALID_SLOT_TIMES');

    const minutes = (timeToSeconds(end) - timeToSeconds(start)) / 60;
    if (minutes < exam.exam_duration_minutes) {
      throw invalid(`The slot is ${minutes} minutes long but the exam lasts ${exam.exam_duration_minutes} minutes.`, 'SLOT_TOO_SHORT', {
        slot_minutes: minutes,
        exam_duration_minutes: exam.exam_duration_minutes,
      });
    }

    const startsAt = `${date} ${start}`;
    const now = await clockModel.now(conn);
    if (startsAt <= now) throw invalid('The slot must start in the future.', 'SLOT_IN_PAST');
    // Slots may be created before registration closes (students choose a slot while registering),
    // so there is deliberately no rule tying the slot start to the registration end date.

    if (await slotModel.findDuplicate({ examinationId, centerId: input.center_id, date, start }, conn)) {
      throw conflict('This exam already has a slot at this center, date and start time.', 'SLOT_EXISTS');
    }

    await assertFits({ centerId: input.center_id, date, start, end, requested: capacity }, conn);

    const id = await slotModel.insert({ examination_id: examinationId, center_id: input.center_id, exam_date: date, slot_start_time: start, slot_end_time: end, capacity }, conn);
    return serialize(await slotModel.findById(id, conn));
  });
}

async function list(examinationId, { center_id: centerId, date }) {
  if (!(await examinationModel.findById(examinationId))) throw notFound('Examination');
  const rows = await slotModel.listByExamination({ examinationId, centerId, date });
  return { slots: rows.map(serialize) };
}

/** Locks exam -> center -> slot for an existing slot. Returns { exam, slot } or throws 404. */
async function lockSlotChain(slotId, conn) {
  const preview = await slotModel.findById(slotId, conn);
  if (!preview) throw notFound();
  const exam = await examinationModel.lockById(preview.examination_id, conn);
  await centerModel.lockById(preview.center_id, conn);
  const slot = await slotModel.lockById(slotId, conn);
  if (!slot || !exam) throw notFound();
  return { exam, slot };
}

async function updateCapacity(slotId, { capacity }) {
  return withTransaction(async (conn) => {
    const { exam, slot } = await lockSlotChain(slotId, conn);
    if (exam.status === 'scheduled' || exam.status === 'completed') {
      throw conflict(`Slots of an examination that is ${exam.status} cannot be changed.`, 'EXAM_LOCKED');
    }

    const now = await clockModel.now(conn);
    if (`${slot.exam_date} ${slot.slot_end_time}` <= now) throw conflict('This slot has already finished.', 'SLOT_FINISHED');

    const booked = await slotModel.bookedCount(slotId, conn);
    if (capacity < booked) {
      throw conflict(`${booked} candidate(s) are already booked, so the capacity cannot go below ${booked}.`, 'CAPACITY_BELOW_BOOKED', { booked_count: booked });
    }

    await assertFits(
      { centerId: slot.center_id, date: slot.exam_date, start: slot.slot_start_time, end: slot.slot_end_time, requested: capacity, excludeId: slotId },
      conn
    );
    await slotModel.update(slotId, { capacity }, conn);
    return serialize(await slotModel.findById(slotId, conn));
  });
}

async function remove(slotId) {
  return withTransaction(async (conn) => {
    const { exam } = await lockSlotChain(slotId, conn);
    if (exam.status === 'completed') throw conflict('Slots of a completed examination cannot be deleted.', 'EXAM_LOCKED');

    const allocations = await slotModel.countAllocations(slotId, conn);
    if (allocations > 0) {
      throw conflict(`This slot has ${allocations} registered candidate(s) and cannot be deleted.`, 'SLOT_IN_USE', { candidates: allocations });
    }

    if (['registration_open', 'scheduled'].includes(exam.status) && (await slotModel.countByExamination(exam.id, conn)) <= 1) {
      throw conflict('This is the only slot of an examination that is open or scheduled. Add another slot first.', 'LAST_SLOT');
    }

    await slotModel.deleteById(slotId, conn);
  });
}

module.exports = { create, list, updateCapacity, remove };
