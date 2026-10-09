// utils/format.js — display helpers.
//
// The backend sends business-time strings with NO time zone ('2026-12-14', '09:00:00',
// '2026-10-01 09:00:00'). They are formatted by splitting the text, never through `new Date()`,
// so the browser's own time zone can never shift a date or an exam time.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ''));
  if (!m) return value ? String(value) : '—';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function formatTime(value) {
  const m = /^(\d{2}):(\d{2})/.exec(String(value ?? ''));
  if (!m) return value ? String(value) : '—';
  const hours = Number(m[1]);
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(twelve).padStart(2, '0')}:${m[2]} ${suffix}`;
}

export function formatDateTime(value) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/.exec(String(value ?? ''));
  if (!m) return value ? String(value) : '—';
  return `${formatDate(m[1])}, ${formatTime(m[2])}`;
}

export function formatTimeRange(start, end) {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

/** 0 -> "Free"; otherwise the plain amount with two decimals (the API does not say which currency). */
export function formatFee(fee) {
  const amount = Number(fee);
  if (!Number.isFinite(amount)) return '—';
  return amount === 0 ? 'Free' : amount.toFixed(2);
}

export function isFree(fee) {
  return Number(fee) === 0;
}

export function formatDuration(minutes) {
  const total = Number(minutes);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${m} min`;
  return h ? `${h} h` : `${m} min`;
}

const ROLE_LABELS = { ADMIN: 'Administrator', STUDENT: 'Student', INVIGILATOR: 'Invigilator', TEACHER: 'Teacher' };
export const roleLabel = (role) => ROLE_LABELS[role] || role || '—';

/** Where each role lands after signing in. Roles without a page yet go to the "no access" page. */
export function homePathFor(role) {
  if (role === 'STUDENT') return '/student/dashboard';
  if (role === 'ADMIN') return '/admin/dashboard';
  return '/unauthorized';
}
