// services/adminService.js — what the admin screens need today (user listing and overview counts).

import { api } from './api';

/** { users, page, limit, total } — the backend never returns password hashes or other secrets. */
export async function getUsers({ page = 1, limit = 10, role = '' } = {}) {
  const params = { page, limit };
  if (role) params.role = role;
  const { data } = await api.get('/admin/users', { params });
  return data.data;
}

async function totalOf(path) {
  const { data } = await api.get(path, { params: { page: 1, limit: 1 } });
  return data.data.total;
}

/** Overview numbers; any one that fails is returned as null so the dashboard still renders. */
export async function getOverviewTotals() {
  const [users, examinations, centers] = await Promise.allSettled([
    totalOf('/admin/users'),
    totalOf('/admin/examinations'),
    totalOf('/admin/centers'),
  ]);
  const pick = (r) => (r.status === 'fulfilled' ? r.value : null);
  return { users: pick(users), examinations: pick(examinations), centers: pick(centers) };
}
