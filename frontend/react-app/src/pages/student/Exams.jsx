// pages/student/Exams.jsx — exams a student can see, with search and pagination (kept in the URL).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { getExams } from '../../services/examService';
import { formatDateTime, formatDuration, formatFee } from '../../utils/format';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import PageHeader from '../../components/PageHeader';
import Pagination from '../../components/Pagination';
import StatusBadge from '../../components/StatusBadge';

const PAGE_SIZE = 9;

export default function Exams() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
  const q = params.get('q') || '';
  const [term, setTerm] = useState(q);

  const exams = useResource(() => getExams({ page, limit: PAGE_SIZE, q }), ['exams', page, q]);

  function search(event) {
    event.preventDefault();
    const next = {};
    if (term.trim()) next.q = term.trim();
    setParams(next);
  }
  function clear() {
    setTerm('');
    setParams({});
  }
  function goTo(nextPage) {
    const next = {};
    if (q) next.q = q;
    if (nextPage > 1) next.page = String(nextPage);
    setParams(next);
  }

  const list = exams.data ? exams.data.examinations : [];

  return (
    <div className="container py-4">
      <PageHeader title="Available exams" subtitle="Open an exam to see its centers and slots." />

      <form className="row g-2 mb-4" onSubmit={search} role="search">
        <div className="col-sm-8 col-md-6">
          <input type="search" className="form-control" placeholder="Search by exam name" aria-label="Search exams" value={term} onChange={(e) => setTerm(e.target.value)} maxLength={100} />
        </div>
        <div className="col-auto d-flex gap-2">
          <button type="submit" className="btn btn-primary">Search</button>
          {(q || term) && <button type="button" className="btn btn-outline-secondary" onClick={clear}>Clear</button>}
        </div>
      </form>

      {exams.loading && <Loading label="Loading exams…" />}
      <ErrorAlert error={exams.error} onRetry={exams.reload} />

      {exams.data && list.length === 0 && (
        <div className="text-center text-secondary py-5">
          <p className="mb-1 fw-semibold">{q ? `No exams match “${q}”.` : 'No exams are available right now.'}</p>
          <p className="mb-0 small">{q ? 'Try a different search.' : 'Please check back later.'}</p>
        </div>
      )}

      <div className="row g-3">
        {list.map((exam) => (
          <div className="col-md-6 col-lg-4" key={exam.id}>
            <div className="card h-100 exam-card">
              <div className="card-body d-flex flex-column">
                <div className="d-flex justify-content-between align-items-start gap-2 mb-2">
                  <h2 className="h6 mb-0">{exam.exam_name}</h2>
                  <StatusBadge kind="state" value={exam.registration_state} />
                </div>
                {exam.description && <p className="text-secondary small flex-grow-0 exam-description">{exam.description}</p>}
                <dl className="small mb-3 mt-auto">
                  <div className="d-flex justify-content-between"><dt className="fw-normal text-secondary">Duration</dt><dd className="mb-0">{formatDuration(exam.exam_duration_minutes)}</dd></div>
                  <div className="d-flex justify-content-between"><dt className="fw-normal text-secondary">Fee</dt><dd className="mb-0">{formatFee(exam.fee)}</dd></div>
                  <div className="d-flex justify-content-between"><dt className="fw-normal text-secondary">Registration opens</dt><dd className="mb-0">{formatDateTime(exam.registration_start_date)}</dd></div>
                  <div className="d-flex justify-content-between"><dt className="fw-normal text-secondary">Registration closes</dt><dd className="mb-0">{formatDateTime(exam.registration_end_date)}</dd></div>
                </dl>
                <Link to={`/student/exams/${exam.id}`} className={`btn ${exam.can_register ? 'btn-primary' : 'btn-outline-primary'}`}>
                  {exam.can_register ? 'Register' : 'View details'}
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {exams.data && <Pagination page={page} limit={PAGE_SIZE} total={exams.data.total} onChange={goTo} disabled={exams.loading} />}
    </div>
  );
}
