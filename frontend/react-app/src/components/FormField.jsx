// components/FormField.jsx — label + input + error/hint text, wired for accessibility.
export default function FormField({ id, label, error, hint, children }) {
  return (
    <div className="mb-3">
      <label htmlFor={id} className="form-label fw-semibold">{label}</label>
      {children}
      {error ? (
        <div id={`${id}-error`} className="invalid-feedback d-block">{error}</div>
      ) : hint ? (
        <div id={`${id}-hint`} className="form-text">{hint}</div>
      ) : null}
    </div>
  );
}
