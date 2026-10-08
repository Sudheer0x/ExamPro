// src/services/examinationService.js — business rules for examinations (admin side).
//
// Status flow:  draft -> registration_open <-> registration_closed -> scheduled -> completed
// (plus registration_open -> draft, but only while nobody has registered). See TRANSITIONS below.

const config = require('../config/env');
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/transaction');
const examinationModel = require('../models/examinationModel');
const slotModel = require('../models/slotModel');
const clockModel = require('../models/clockModel');

const TRANSITIONS = {
  draft: ['registration_open'],
  registration_open: ['registration_closed', 'draft'],
  registration_closed: ['registration_open', 'scheduled'],
  scheduled: ['completed'],
  completed: [],
};
const READ_ONLY = new Set(['scheduled', 'completed']);

const notFound = () => new AppError('Examination not found.', 404);
const conflict = (message, code, details) => new AppError(message, 409, { code, ...(details ? { details } : {}) });
const invalid = (message, code, details) => new AppError(message, 422, { code, ...(details ? { details } : {}) });

const serialize = (row) => ({ ...row, timezone: config.db.timeZone });

function assertWindow(start, end) {
  if (!(end > start)) throw invalid('Registration must close after it opens.', 'INVALID_WINDOW');
}

function definedOnly(input) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

async function create(input) {
  assertWindow(input.registration_start_date, input.registration_end_date);
  const id = await examinationModel.insert({
    exam_name: input.exam_name,
    description: input.description ?? null,
    instructions: input.instructions ?? null,
    registration_start_date: input.registration_start_date,
    registration_end_date: input.registration_end_date,
    exam_duration_minutes: input.exam_duration_minutes,
    fee: input.fee ?? '0.00',
  });
  return serialize(await examinationModel.findById(id));
}

async function list({ page, limit, status, q }) {
  const { rows, total } = await examinationModel.list({ limit, offset: (page - 1) * limit, status, q });
  return { examinations: rows.map(serialize), page, limit, total };
}

async function get(id) {
  const exam = await examinationModel.findById(id);
  if (!exam) throw notFound();
  const summary = await examinationModel.getSummary(id);
  return {
    examination: serialize(exam),
    slots_summary: { count: summary.slot_count, total_capacity: summary.total_capacity },
    registration_count: summary.registration_count,
  };
}

async function update(id, input) {
  return withTransaction(async (conn) => {
    const exam = await examinationModel.lockById(id, conn);
    if (!exam) throw notFound();
    if (READ_ONLY.has(exam.status)) {
      throw conflict(`An examination that is ${exam.status} can no longer be edited.`, 'EXAM_LOCKED');
    }

    const changes = definedOnly(input);
    const registrations = await examinationModel.countRegistrations(id, conn);
    const durationChanged = changes.exam_duration_minutes !== undefined && changes.exam_duration_minutes !== exam.exam_duration_minutes;
    const feeChanged = changes.fee !== undefined && Number(changes.fee) !== Number(exam.fee);
    if (registrations > 0 && (durationChanged || feeChanged)) {
      throw conflict('Duration and fee cannot be changed once candidates have registered.', 'HAS_REGISTRATIONS', { registrations });
    }

    const start = changes.registration_start_date ?? exam.registration_start_date;
    const end = changes.registration_end_date ?? exam.registration_end_date;
    assertWindow(start, end);

    const windowChanged = changes.registration_start_date !== undefined || changes.registration_end_date !== undefined;
    if (windowChanged && exam.status === 'registration_open') {
      const now = await clockModel.now(conn);
      if (end <= now) throw conflict('Registration is open, so it cannot end in the past.', 'REGISTRATION_WINDOW_PAST');
    }

    if (durationChanged) {
      const shortest = await slotModel.shortestSlotMinutes(id, conn);
      if (shortest !== null && shortest < changes.exam_duration_minutes) {
        throw conflict('A slot of this exam is shorter than the new duration.', 'SLOT_TOO_SHORT', { shortest_slot_minutes: shortest });
      }
    }

    await examinationModel.update(id, changes, conn);
    return serialize(await examinationModel.findById(id, conn));
  });
}

async function changeStatus(id, to) {
  return withTransaction(async (conn) => {
    const exam = await examinationModel.lockById(id, conn);
    if (!exam) throw notFound();

    const from = exam.status;
    const allowed = TRANSITIONS[from] || [];
    if (!allowed.includes(to)) {
      throw conflict(`An examination cannot go from ${from} to ${to}.`, 'INVALID_TRANSITION', { from, to, allowed });
    }

    const now = await clockModel.now(conn);

    if (to === 'registration_open') {
      if (exam.registration_end_date <= now) {
        throw conflict('The registration end date has already passed. Extend it first.', 'REGISTRATION_WINDOW_PAST');
      }
      if ((await slotModel.countByExamination(id, conn)) < 1) {
        throw conflict('Add at least one slot before opening registration.', 'NO_SLOTS');
      }
      const inactive = await slotModel.countSlotsAtInactiveCenters(id, conn);
      if (inactive > 0) {
        throw conflict('Some slots are at deactivated centers. Remove them or reactivate the center.', 'INACTIVE_CENTER_SLOTS', { slots: inactive });
      }
    }

    if (to === 'draft') {
      const registrations = await examinationModel.countRegistrations(id, conn);
      if (registrations > 0) {
        throw conflict('Candidates have already registered, so the exam cannot go back to draft.', 'HAS_REGISTRATIONS', { registrations });
      }
    }

    if (to === 'scheduled' && (await slotModel.countByExamination(id, conn)) < 1) {
      throw conflict('Add at least one slot before scheduling the exam.', 'NO_SLOTS');
    }

    if (to === 'completed') {
      const unfinished = await slotModel.countUnfinishedSlots(id, now, conn);
      if (unfinished > 0) {
        throw conflict('Some slots have not finished yet.', 'SLOTS_NOT_FINISHED', { unfinished_slots: unfinished });
      }
    }

    await examinationModel.setStatus(id, to, conn);
    return serialize(await examinationModel.findById(id, conn));
  });
}

module.exports = { create, list, get, update, changeStatus, TRANSITIONS };
