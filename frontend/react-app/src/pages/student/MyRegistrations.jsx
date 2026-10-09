// pages/student/MyRegistrations.jsx — the student's registrations, with cancellation when the backend allows it.
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { cancelRegistration, getMyRegistrations } from '../../services/registrationService';
import { toApiError } from '../../utils/errors';
import { formatDate, formatDateTime, formatFee, formatTimeRange } from '../../utils/format';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import StatusBadge from '../../components/StatusBadge';

const PAGE_SIZE = 10;

export default function MyRegistrations() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const list = useResource(() => getMyRegistrations({ page, limit: PAGE_SIZE }), ['my-registrations', page]);

  const [target, setTarget] = useState(null); // the registration the student is about to cancel
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [notice, setNotice] = useState(null);

  function goTo(nextPage) {
    setParams(nextPage > 1 ? { page: String(nextPage) } : {});
  }

  async function confirmCancel() {
    if (!target || cancelling) return;
    setCancelling(true);
    setActionError(null);
    setNotice(null);
    try {
      await cancelRegistration(target.id);
      setNotice(`Registration ${target.registration_id} was cancelled.`);
    } catch (err) {
      setActionError(toApiError(err)); // e.g. ALREADY_CANCELLED, CANCELLATION_CLOSED, PAYMENT_RECEIVED
    } finally {
      setCancelling(false);
      setTarget(null);
      list.reload(); // always show what the server says now
    }
  }

  const rows = list.data ? list.data.registrations : [];

  return (
    <div className="container py-4">
      <PageHeader title="My registrations" subtitle="Everything you have registered for.">
        <Link to="/student/exams" className="btn btn-outline-primary">Browse exams</Link>
      </PageHeader>

      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <ErrorAlert error={actionError} className="mb-3" />
      {list.loading && <Loading label="Loading registrations…" />}
      <ErrorAlert error={list.error} onRetry={list.reload} />

      {list.data && rows.length === 0 && (
        <div className="text-center text-secondary py-5">
          <p className="fw-semibold mb-1">You have not registered for any exam yet.</p>
          <Link to="/student/exams">Find an exam</Link>
        </div>
      )}

      {rows.length > 0 && (
        <div className="card">
          <div className="table-responsive">
            <table className="table table-hover align-middle mb-0">
              <thead className="table-light">
                <tr>
                  <th>Registration ID</th><th>Application ID</th><th>Exam</th><th>Center</th><th>Date and time</th><th>Status</th><th className="text-end">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((reg) => (
                  <tr key={reg.id}>
                    <td className="fw-semibold">{reg.registration_id}<div className="small text-secondary fw-normal">Registered {formatDateTime(reg.registered_at)}</div></td>
                    <td>{reg.application_id}</td>
                    <td>
                      <Link to={`/student/exams/${reg.examination.id}`} className="text-decoration-none">{reg.examination.exam_name}</Link>
                      <div className="small text-secondary">Fee: {formatFee(reg.examination.fee)}</div>
                    </td>
                    <td>{reg.center ? (<>{reg.center.center_name}<div className="small text-secondary">{[reg.center.city, reg.center.state].filter(Boolean).join(', ')}</div></>) : <span className="text-secondary">—</span>}</td>
                    <td>{reg.slot ? (<>{formatDate(reg.slot.exam_date)}<div className="small text-secondary">{formatTimeRange(reg.slot.slot_start_time, reg.slot.slot_end_time)}</div></>) : <span className="text-secondary">—</span>}</td>
                    <td>
                      <StatusBadge kind="registration" value={reg.status} />
                      {reg.status === 'pending_payment' && <div className="small text-secondary mt-1">Online payment is not available yet.</div>}
                    </td>
                    <td className="text-end">
                      {reg.can_cancel ? (
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => setTarget(reg)} disabled={cancelling}>Cancel</button>
                      ) : (
                        <span className="small text-secondary">{reg.status === 'cancelled' ? '' : 'Cannot be cancelled'}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {list.data && <Pagination page={page} limit={PAGE_SIZE} total={list.data.total} onChange={goTo} disabled={list.loading} />}

      <ConfirmDialog
        open={Boolean(target)}
        title="Cancel this registration?"
        confirmLabel="Yes, cancel registration"
        variant="danger"
        busy={cancelling}
        onConfirm={confirmCancel}
        onCancel={() => setTarget(null)}
      >
        {target && (
          <p className="mb-0">
            You are about to cancel <strong>{target.registration_id}</strong> for <strong>{target.examination.exam_name}</strong>. Your seat will be released.
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
