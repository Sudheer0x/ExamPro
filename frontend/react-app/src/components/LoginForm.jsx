// components/LoginForm.jsx — the sign-in form shared by the student and admin login pages.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { toApiError, makeApiError } from '../utils/errors';
import { normalizeEmail, validateLogin } from '../utils/validators';
import ErrorAlert from './ErrorAlert';
import FormField from './FormField';

export default function LoginForm({ accountType, allowedRoles, initialEmail = '', notice = null, footer = null }) {
  const { login } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;
    const problems = validateLogin({ email, password });
    setFieldErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;

    setSubmitting(true);
    try {
      // On success AuthContext sets the user and the route guard moves the visitor to their dashboard.
      await login({ email: normalizeEmail(email), password, accountType, allowedRoles });
    } catch (err) {
      const apiError = toApiError(err);
      setPassword(''); // never keep a rejected password around
      setError(apiError.status === 401 ? makeApiError('Invalid email or password.', { status: 401, code: apiError.code }) : apiError);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {notice && <div className="alert alert-success" role="status">{notice}</div>}
      <ErrorAlert error={error} className="mb-3" />
      {error && error.code === 'EMAIL_NOT_VERIFIED' && (
        <p className="small">
          <Link to="/verify-otp" state={{ email: normalizeEmail(email) }}>Enter your verification code</Link>
        </p>
      )}

      <FormField id="login-email" label="Email" error={fieldErrors.email}>
        <input id="login-email" type="email" className={`form-control${fieldErrors.email ? ' is-invalid' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus disabled={submitting} />
      </FormField>
      <FormField id="login-password" label="Password" error={fieldErrors.password}>
        <input id="login-password" type="password" className={`form-control${fieldErrors.password ? ' is-invalid' : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={submitting} />
      </FormField>

      <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
        {submitting ? (<><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Signing in…</>) : 'Sign in'}
      </button>
      {footer && <div className="text-center mt-3 small">{footer}</div>}
    </form>
  );
}
