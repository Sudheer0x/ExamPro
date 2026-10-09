// pages/admin/AdminUsers.jsx — staff accounts (admin / teacher / invigilator). The API never returns secrets.
import { useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { getUsers } from '../../services/adminService';
import { formatDateTime } from '../../utils/format';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import StatusBadge from '../../components/StatusBadge';

const PAGE_SIZE = 10;
const ROLES = [['', 'All roles'], ['admin', 'Administrators'], ['teacher', 'Teachers'], ['invigilator', 'Invigilators']];

export default function AdminUsers() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const role = ROLES.some(([value]) => value === params.get('role')) ? params.get('role') || '' : '';

  const users = useResource(() => getUsers({ page, limit: PAGE_SIZE, role }), ['admin-users', page, role]);
  const rows = users.data ? users.data.users : [];

  function update(next) {
    const merged = { page: String(next.page ?? page), role: next.role ?? role };
    const clean = {};
    if (merged.role) clean.role = merged.role;
    if (Number(merged.page) > 1) clean.page = merged.page;
    setParams(clean);
  }

  return (
    <div className="container py-4">
      <PageHeader title="Users" subtitle="Staff accounts (administrators, teachers and invigilators).">
        <select className="form-select" aria-label="Filter by role" value={role} onChange={(e) => update({ role: e.target.value, page: 1 })}>
          {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </PageHeader>

      {users.loading && <Loading label="Loading users…" />}
      <ErrorAlert error={users.error} onRetry={users.reload} />

      {users.data && rows.length === 0 && <p className="text-center text-secondary py-5">No users found.</p>}

      {rows.length > 0 && (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th></tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td className="fw-semibold">{u.full_name}</td>
                    <td>{u.email}</td>
                    <td><StatusBadge kind="role" value={String(u.role).toUpperCase()} /></td>
                    <td><StatusBadge kind="active" value={Boolean(u.is_active)} /></td>
                    <td>{formatDateTime(u.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {users.data && <Pagination page={page} limit={PAGE_SIZE} total={users.data.total} onChange={(n) => update({ page: n })} disabled={users.loading} />}
    </div>
  );
}
