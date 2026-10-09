// pages/auth/Register.jsx — student registration. Sends exactly the fields the backend accepts.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { registerStudent } from '../../services/authService';
import { toApiError } from '../../utils/errors';
import { BACKEND_FIELD_MAP, normalizeEmail, toRegistrationPayload, validateRegistration } from '../../utils/validators';
import ErrorAlert from '../../components/ErrorAlert';
import FormField from '../../components/FormField';

const EMPTY = { fullName: '', email: '', mobile: '', dateOfBirth: '', password: '', confirmPassword: '' };

export default function Register() {
  const navigate = useNavigate();
  const [values, setValues] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState({});
  const [error, setError] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function handleChange(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: undefined }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (submitting) return;

    const problems = validateRegistration(values);
    setFieldErrors(problems);
    setError(null);
    if (Object.keys(problems).length) return;

    setSubmitting(true);
    try {
      await registerStudent(toRegistrationPayload(values));
      navigate('/verify-otp', { replace: true, state: { email: normalizeEmail(values.email), justRegistered: true } });
    } catch (err) {
      const apiError = toApiError(err);
      const mapped = {};
      for (const [field, message] of Object.entries(apiError.fieldErrors)) mapped[BACKEND_FIELD_MAP[field] || field] = message;
      setFieldErrors(mapped);
      setError(Object.keys(mapped).length ? { ...apiError, message: 'Please correct the highlighted fields.' } : apiError);
    } finally {
      setSubmitting(false);
    }
  }

  const input = (name, type, extra = {}) => ({
    id: `reg-${name}`,
    name,
    type,
    value: values[name],
    onChange: handleChange,
    disabled: submitting,
    className: `form-control${fieldErrors[name] ? ' is-invalid' : ''}`,
    'aria-describedby': fieldErrors[name] ? `reg-${name}-error` : undefined,
    ...extra,
  });

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-9 col-lg-7">
          <div className="card shadow-sm">
            <div className="card-body p-4">
              <h1 className="h4 mb-1">Create your student account</h1>
              <p className="text-secondary">Any valid email address works. We will send a 6-digit code to confirm it.</p>

              <form onSubmit={handleSubmit} noValidate>
                <ErrorAlert error={error} className="mb-3" />

                <FormField id="reg-fullName" label="Full name" error={fieldErrors.fullName}>
                  <input {...input('fullName', 'text', { autoComplete: 'name', autoFocus: true })} />
                </FormField>
                <FormField id="reg-email" label="Email" error={fieldErrors.email}>
                  <input {...input('email', 'email', { autoComplete: 'email' })} />
                </FormField>
                <div className="row">
                  <div className="col-md-6">
                    <FormField id="reg-mobile" label="Mobile number" error={fieldErrors.mobile} hint="10 to 15 digits, optional leading +">
                      <input {...input('mobile', 'tel', { autoComplete: 'tel', inputMode: 'tel' })} />
                    </FormField>
                  </div>
                  <div className="col-md-6">
                    <FormField id="reg-dateOfBirth" label="Date of birth (optional)" error={fieldErrors.dateOfBirth}>
                      <input {...input('dateOfBirth', 'date', { autoComplete: 'bday' })} />
                    </FormField>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-6">
                    <FormField id="reg-password" label="Password" error={fieldErrors.password} hint="8–64 characters with at least one letter and one number">
                      <input {...input('password', showPassword ? 'text' : 'password', { autoComplete: 'new-password' })} />
                    </FormField>
                  </div>
                  <div className="col-md-6">
                    <FormField id="reg-confirmPassword" label="Confirm password" error={fieldErrors.confirmPassword}>
                      <input {...input('confirmPassword', showPassword ? 'text' : 'password', { autoComplete: 'new-password' })} />
                    </FormField>
                  </div>
                </div>
                <div className="form-check mb-3">
                  <input id="reg-show" type="checkbox" className="form-check-input" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />
                  <label htmlFor="reg-show" className="form-check-label">Show passwords</label>
                </div>

                <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                  {submitting ? (<><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Registering…</>) : 'Register'}
                </button>
              </form>

              <p className="text-center small mt-3 mb-0">Already registered? <Link to="/login">Sign in</Link></p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
