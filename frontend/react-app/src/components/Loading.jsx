// components/Loading.jsx — spinner with a label.
export default function Loading({ label = 'Loading…', fullPage = false }) {
  const spinner = (
    <div className="d-flex align-items-center justify-content-center gap-2 text-secondary py-4" role="status" aria-live="polite">
      <span className="spinner-border spinner-border-sm" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
  return fullPage ? <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '50vh' }}>{spinner}</div> : spinner;
}
