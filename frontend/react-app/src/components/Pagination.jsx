// components/Pagination.jsx — previous / numbered / next, for any list the API paginates.
export default function Pagination({ page, limit, total, onChange, disabled = false }) {
  const pages = Math.max(1, Math.ceil((Number(total) || 0) / limit));
  if (pages <= 1) return null;

  const first = Math.max(1, Math.min(page - 2, pages - 4));
  const last = Math.min(pages, first + 4);
  const numbers = [];
  for (let n = first; n <= last; n += 1) numbers.push(n);

  return (
    <nav aria-label="Pagination" className="d-flex flex-wrap align-items-center justify-content-between gap-2 mt-3">
      <span className="text-secondary small">Page {page} of {pages} · {total} in total</span>
      <ul className="pagination pagination-sm mb-0">
        <li className={`page-item ${page <= 1 || disabled ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(page - 1)} disabled={page <= 1 || disabled}>Previous</button>
        </li>
        {numbers.map((n) => (
          <li key={n} className={`page-item ${n === page ? 'active' : ''}`}>
            <button type="button" className="page-link" onClick={() => onChange(n)} disabled={disabled} aria-current={n === page ? 'page' : undefined}>{n}</button>
          </li>
        ))}
        <li className={`page-item ${page >= pages || disabled ? 'disabled' : ''}`}>
          <button type="button" className="page-link" onClick={() => onChange(page + 1)} disabled={page >= pages || disabled}>Next</button>
        </li>
      </ul>
    </nav>
  );
}
