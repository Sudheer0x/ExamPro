// services/examService.js — student exam discovery. (All endpoints need a STUDENT login.)

import { api } from './api';

/** { examinations, page, limit, total } */
export async function getExams({ page = 1, limit = 9, q = '' } = {}) {
  const params = { page, limit };
  if (q) params.q = q;
  const { data } = await api.get('/exam', { params });
  return data.data;
}

/** { examination } — includes instructions and my_registration */
export async function getExam(id) {
  const { data } = await api.get(`/exam/${encodeURIComponent(id)}`);
  return data.data;
}

/** { examination: { id, exam_name, registration_state, can_register }, slots: [...] } */
export async function getExamSlots(id, options = {}) {
  const params = {};
  if (options.centerId) params.center_id = options.centerId;
  if (options.date) params.date = options.date;
  const { data } = await api.get(`/exam/${encodeURIComponent(id)}/slots`, { params });
  return data.data;
}
