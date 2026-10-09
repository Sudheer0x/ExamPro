// components/ErrorAlert.jsx — shows a failure as a friendly message (never a raw error object).
import { toApiError } from '../utils/errors';

export default function ErrorAlert({ error, onRetry, className = '' }) {
  if (!error) return null;
  const { message } = toApiError(error);
  return (
    <div className={`alert alert-danger d-flex flex-wrap align-items-center justify-content-between gap-2 ${className}`} role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn-sm btn-outline-danger" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
