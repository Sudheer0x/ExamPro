// components/StatusBadge.jsx — one place that decides how each status looks.
const LOOKS = {
  registration: {
    completed: ['success', 'Completed'],
    pending_payment: ['warning text-dark', 'Payment pending'],
    cancelled: ['secondary', 'Cancelled'],
  },
  state: {
    open: ['success', 'Registration open'],
    upcoming: ['info text-dark', 'Opens soon'],
    closed: ['secondary', 'Registration closed'],
  },
  exam: {
    registration_open: ['success', 'Open'],
    registration_closed: ['secondary', 'Registration closed'],
    scheduled: ['primary', 'Scheduled'],
    draft: ['secondary', 'Draft'],
    completed: ['dark', 'Completed'],
  },
  active: {
    true: ['success', 'Active'],
    false: ['danger', 'Disabled'],
  },
  role: {
    ADMIN: ['danger', 'Administrator'],
    STUDENT: ['primary', 'Student'],
    INVIGILATOR: ['info text-dark', 'Invigilator'],
    TEACHER: ['secondary', 'Teacher'],
  },
};

export default function StatusBadge({ kind, value }) {
  const look = (LOOKS[kind] || {})[String(value)];
  const [color, label] = look || ['secondary', String(value ?? '—')];
  return <span className={`badge text-bg-${color.split(' ')[0]} ${color.includes('text-dark') ? 'text-dark' : ''}`}>{label}</span>;
}
