// pages/student/StudentDashboard.jsx — welcome page for the signed-in student.
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { useResource } from '../../hooks/useResource';
import { getExams } from '../../services/examService';
import { getMyRegistrations } from '../../services/registrationService';
import { formatDateTime, formatTime, formatDate } from '../../utils/format';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';

export default function StudentDashboard() {
  const { user } = useAuth();
  const exams = useResource(() => getExams({ page: 1, limit: 3 }), ['dashboard-exams']);
  const mine = useResource(() => getMyRegistrations({ page: 1, limit: 5 }), ['dashboard-registrations']);

  return (
    <div className="container py-4">
      <PageHeader title={`Welcome, ${user.full_name || user.email}`} subtitle="Find an exam, choose your center and slot, and keep track of your registrations." />

      <div className="row g-3 mb-4">
        <div className="col-md-4">
          <div className="card h-100 stat-card"><div className="card-body">
            <div className="text-secondary small">Available exams</div>
            <div className="display-6 fw-semibold">{exams.loading ? '…' : exams.data ? exams.data.total : '—'}</div>
            <Link to="/student/exams" className="stretched-link small">Browse exams</Link>
          </div></div>
        </div>
        <div className="col-md-4">
          <div className="card h-100 stat-card"><div className="card-body">
            <div className="text-secondary small">My registrations</div>
            <div className="display-6 fw-semibold">{mine.loading ? '…' : mine.data ? mine.data.total : '—'}</div>
            <Link to="/student/registrations" className="stretched-link small">View registrations</Link>
          </div></div>
        </div>
        <div className="col-md-4">
          <div className="card h-100 stat-card"><div className="card-body">
            <div className="text-secondary small">My profile</div>
            <div className="fw-semibold text-truncate">{user.email}</div>
            <Link to="/student/profile" className="stretched-link small">Open profile</Link>
          </div></div>
        </div>
      </div>

      <div className="row g-3">
        <div className="col-lg-6">
          <div className="card h-100"><div className="card-body">
            <h2 className="h6 mb-3">Exams open to you</h2>
            {exams.loading && <Loading label="Loading exams…" />}
            <ErrorAlert error={exams.error} onRetry={exams.reload} />
            {exams.data && exams.data.examinations.length === 0 && <p className="text-secondary mb-0">No exams are available right now.</p>}
            {exams.data && exams.data.examinations.length > 0 && (
              <ul className="list-group list-group-flush">
                {exams.data.examinations.map((exam) => (
                  <li key={exam.id} className="list-group-item px-0 d-flex justify-content-between align-items-center gap-2">
                    <div>
                      <Link to={`/student/exams/${exam.id}`} className="fw-semibold text-decoration-none">{exam.exam_name}</Link>
                      <div className="small text-secondary">Registration ends {formatDateTime(exam.registration_end_date)}</div>
                    </div>
                    <StatusBadge kind="state" value={exam.registration_state} />
                  </li>
                ))}
              </ul>
            )}
          </div></div>
        </div>

        <div className="col-lg-6">
          <div className="card h-100"><div className="card-body">
            <h2 className="h6 mb-3">Recent registrations</h2>
            {mine.loading && <Loading label="Loading registrations…" />}
            <ErrorAlert error={mine.error} onRetry={mine.reload} />
            {mine.data && mine.data.registrations.length === 0 && <p className="text-secondary mb-0">You have not registered for any exam yet.</p>}
            {mine.data && mine.data.registrations.length > 0 && (
              <ul className="list-group list-group-flush">
                {mine.data.registrations.map((reg) => (
                  <li key={reg.id} className="list-group-item px-0 d-flex justify-content-between align-items-center gap-2">
                    <div>
                      <div className="fw-semibold">{reg.examination.exam_name}</div>
                      <div className="small text-secondary">
                        {reg.slot ? `${formatDate(reg.slot.exam_date)}, ${formatTime(reg.slot.slot_start_time)}` : 'No slot'} · {reg.registration_id}
                      </div>
                    </div>
                    <StatusBadge kind="registration" value={reg.status} />
                  </li>
                ))}
              </ul>
            )}
          </div></div>
        </div>
      </div>
    </div>
  );
}
