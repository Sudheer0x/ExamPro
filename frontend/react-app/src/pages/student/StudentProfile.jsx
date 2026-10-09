// pages/student/StudentProfile.jsx — the signed-in student's own profile (safe fields only).
import { useResource } from '../../hooks/useResource';
import { getStudentProfile } from '../../services/authService';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';

export default function StudentProfile() {
  const profile = useResource(() => getStudentProfile(), ['student-profile']);
  const p = profile.data;

  return (
    <div className="container py-4">
      <PageHeader title="My profile" subtitle="Your account details." />
      {profile.loading && <Loading label="Loading profile…" />}
      <ErrorAlert error={profile.error} onRetry={profile.reload} />
      {p && (
        <div className="card" style={{ maxWidth: 640 }}>
          <div className="card-body">
            <dl className="row mb-0">
              <dt className="col-sm-4 text-secondary fw-normal">Full name</dt>
              <dd className="col-sm-8 fw-semibold">{p.full_name}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Email</dt>
              <dd className="col-sm-8">{p.email}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Phone</dt>
              <dd className="col-sm-8">{p.phone || '—'}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Email verified</dt>
              <dd className="col-sm-8">{p.email_verified ? <span className="badge text-bg-success">Verified</span> : <span className="badge text-bg-warning text-dark">Not verified</span>}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Account status</dt>
              <dd className="col-sm-8"><span className={`badge text-bg-${p.account_status === 'ACTIVE' ? 'success' : 'warning text-dark'}`}>{p.account_status === 'ACTIVE' ? 'Active' : String(p.account_status || '—')}</span></dd>
              <dt className="col-sm-4 text-secondary fw-normal">Student ID</dt>
              <dd className="col-sm-8">{p.id}</dd>
            </dl>
          </div>
        </div>
      )}
    </div>
  );
}
