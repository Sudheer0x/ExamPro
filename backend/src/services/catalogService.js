// src/services/catalogService.js — student exam discovery (read-only).
//
// A student sees exams that are open, closed or scheduled — never drafts or completed exams — and only
// the fields in toStudentExam(). Each exam says whether the student can register RIGHT NOW (using
// MySQL's clock), so the website never has to work that out itself.

const config = require('../config/env');
const AppError = require('../utils/AppError');
const { registrationState } = require('../utils/registrationRules');
const catalogModel = require('../models/catalogModel');
const clockModel = require('../models/clockModel');

const notFound = () => new AppError('Examination not found.', 404);

function toStudentExam(row, now) {
  const state = registrationState(row, now);
  return {
    id: row.id,
    exam_name: row.exam_name,
    description: row.description,
    registration_start_date: row.registration_start_date,
    registration_end_date: row.registration_end_date,
    exam_duration_minutes: row.exam_duration_minutes,
    fee: row.fee,
    status: row.status,
    registration_state: state,
    can_register: state === 'open',
    timezone: config.db.timeZone,
  };
}

async function listExams({ page, limit, q }) {
  const now = await clockModel.now();
  const { rows, total } = await catalogModel.listVisibleExams({ limit, offset: (page - 1) * limit, q });
  return { examinations: rows.map((r) => toStudentExam(r, now)), page, limit, total };
}

async function getExam(studentId, examId) {
  const row = await catalogModel.findVisibleExam(examId);
  if (!row) throw notFound();
  const now = await clockModel.now();
  const mine = await catalogModel.findActiveRegistration(studentId, examId);
  return {
    examination: {
      ...toStudentExam(row, now),
      instructions: row.instructions,
      my_registration: mine ? { id: mine.id, registration_id: mine.registration_id, status: mine.status } : null,
    },
  };
}

async function listSlots(examId, { center_id: centerId, date }) {
  const exam = await catalogModel.findVisibleExam(examId);
  if (!exam) throw notFound();
  const now = await clockModel.now();
  const rows = await catalogModel.listSlotsForExam({ examinationId: examId, centerId, date, now });

  const state = registrationState(exam, now);
  return {
    examination: { id: exam.id, exam_name: exam.exam_name, registration_state: state, can_register: state === 'open' },
    slots: rows.map((s) => {
      const capacity = Number(s.capacity);
      const booked = Number(s.booked_count);
      const left = Math.max(0, capacity - booked);
      return {
        id: s.id,
        examination_id: s.examination_id,
        center_id: s.center_id,
        center_name: s.center_name,
        city: s.city,
        state: s.state,
        address: s.address,
        exam_date: s.exam_date,
        slot_start_time: s.slot_start_time,
        slot_end_time: s.slot_end_time,
        capacity,
        booked_count: booked,
        seats_left: left,
        is_full: left === 0,
        timezone: config.db.timeZone,
      };
    }),
  };
}

module.exports = { listExams, getExam, listSlots, toStudentExam };
