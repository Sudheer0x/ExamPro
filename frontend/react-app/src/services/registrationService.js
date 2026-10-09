// services/registrationService.js — a student's registrations.
// The student is identified by the access token on the server. NEVER add a student_id to these requests.

import { api } from './api';

/** { registrations, page, limit, total } */
export async function getMyRegistrations({ page = 1, limit = 10 } = {}) {
  const { data } = await api.get('/registration/mine', { params: { page, limit } });
  return data.data;
}

/** The ONLY thing the backend accepts is { slot_id }. */
export async function createRegistration(slotId) {
  const { data } = await api.post('/registration', { slot_id: Number(slotId) });
  return data.data.registration;
}

export async function cancelRegistration(id) {
  const { data } = await api.delete(`/registration/${encodeURIComponent(id)}`);
  return data.data.registration;
}
