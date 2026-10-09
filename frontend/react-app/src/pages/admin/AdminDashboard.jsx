// pages/admin/AdminDashboard.jsx — overview for the signed-in administrator.
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/useAuth';
import { useResource } from '../../hooks/useResource';
import { getOverviewTotals } from '../../services/adminService';
import { roleLabel } from '../../utils/format';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';

export default function AdminDashboard() {
  const { user } = useAuth();
  const overview = useResource(() => getOverviewTotals(), ['admin-overview']);
  const totals = overview.data;
  const show = (value) => (overview.loading ? '…' : value === null || value === undefined ? '—' : value);

  return (
    <div className="container py-4">
      <PageHeader title="Administrator dashboard" subtitle="An overview of ExamPro." />

      <div className="row g-3 mb-4">
        <div className="col-md-6 col-lg-3">
          <div className="card h-100"><div className="card-body">
            <div className="text-secondary small">Signed in as</div>
            <div className="fw-semibold">{user.full_name || user.email}</div>
            <div className="small text-secondary text-truncate">{user.email}</div>
            <span className="badge text-bg-danger mt-2">{roleLabel(user.role)}</span>
          </div></div>
        </div>
        <div className="col-md-6 col-lg-3">
          <div className="card h-100 stat-card"><div className="card-body">
            <div className="text-secondary small">Staff accounts</div>
            <div className="display-6 fw-semibold">{show(totals && totals.users)}</div>
            <Link to="/admin/users" className="stretched-link small">Manage users</Link>
          </div></div>
        </div>
        <div className="col-md-6 col-lg-3">
          <div className="card h-100"><div className="card-body">
            <div className="text-secondary small">Examinations</div>
            <div className="display-6 fw-semibold">{show(totals && totals.examinations)}</div>
          </div></div>
        </div>
        <div className="col-md-6 col-lg-3">
          <div className="card h-100"><div className="card-body">
            <div className="text-secondary small">Exam centers</div>
            <div className="display-6 fw-semibold">{show(totals && totals.centers)}</div>
          </div></div>
        </div>
      </div>

      {overview.loading && <Loading label="Loading overview…" />}

      <div className="card">
        <div className="card-body">
          <h2 className="h6">Coming next</h2>
          <p className="text-secondary mb-0">Screens for examinations, exam centers, computers and slots will be added to this dashboard. Their server features already exist; only the screens are still to be built.</p>
        </div>
      </div>
    </div>
  );
}
