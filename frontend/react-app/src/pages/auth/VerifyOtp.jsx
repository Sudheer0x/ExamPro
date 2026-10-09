// pages/auth/VerifyOtp.jsx — confirm the email with the 6-digit code.
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { resendOtp, verifyOtp } from '../../services/authService';
import { toApiError } from '../../utils/errors';
import { normalizeEmail, validateEmail, validateOtp } from '../../utils/validators';
import ErrorAlert from '../../components/ErrorAlert';
import FormField from '../../components/FormField';

const RESEND_SECONDS = 60;

function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  if (!name || !domain) return email;
  return `${name.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(name.length - 1, 6)))}@${domain}`;
}

export default function VerifyOtp() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const knownEmail = normalizeEmail((location.state && location.state.email) || params.get('email') || '');
  const [typedEmail, setTypedEmail] = useState('');
  const email = knownEmail || normalizeEmail(typedEmail);

  const [otp, setOtp] = useState('');
  const [error, setError] = useState(null);
  const [fieldError, setFieldError] = useState(null);
  const [notice, setNotice] = useState(
    location.state && location.state.justRegistered ? 'Registration received. We sent a 6-digit code to your email.' : null
  );
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(() => (location.state && location.state.justRegistered ? RESEND_SECONDS : 0));

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleVerify(event) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setNotice(null);

    const emailProblem = validateEmail(email);
    const otpProblem = validateOtp(otp);
    setFieldError(emailProblem ? { email: emailProblem } : otpProblem ? { otp: otpProblem } : null);
    if (emailProblem || otpProblem) return;

    setSubmitting(true);
    try {
      await verifyOtp(email, otp.trim());
      navigate('/login', { replace: true, state: { verifiedEmail: email } });
    } catch (err) {
      setError(toApiError(err));
      setOtp('');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResend() {
    if (resending || cooldown > 0) return;
    const emailProblem = validateEmail(email);
    if (emailProblem) { setFieldError({ email: emailProblem }); return; }

    setResending(true);
    setError(null);
    setNotice(null);
    try {
      await resendOtp(email);
      setNotice('If this email is waiting for verification, a new code has been sent.');
      setCooldown(RESEND_SECONDS);
    } catch (err) {
      const apiError = toApiError(err);
      setError(apiError);
      if (apiError.retryAfterSeconds) setCooldown(apiError.retryAfterSeconds);
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-7 col-lg-5">
          <div className="card shadow-sm">
            <div className="card-body p-4">
              <h1 className="h4 mb-1">Verify your email</h1>
              {knownEmail ? (
                <p className="text-secondary">Enter the 6-digit code sent to <strong>{maskEmail(knownEmail)}</strong>. It expires after a few minutes.</p>
              ) : (
                <p className="text-secondary">Enter your email and the 6-digit code we sent you.</p>
              )}

              <form onSubmit={handleVerify} noValidate>
                {notice && <div className="alert alert-success" role="status">{notice}</div>}
                <ErrorAlert error={error} className="mb-3" />

                {!knownEmail && (
                  <FormField id="otp-email" label="Email" error={fieldError && fieldError.email}>
                    <input id="otp-email" type="email" className={`form-control${fieldError && fieldError.email ? ' is-invalid' : ''}`} value={typedEmail} onChange={(e) => setTypedEmail(e.target.value)} autoComplete="email" disabled={submitting} />
                  </FormField>
                )}

                <FormField id="otp-code" label="Verification code" error={fieldError && fieldError.otp}>
                  <input
                    id="otp-code"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="123456"
                    className={`form-control form-control-lg text-center otp-input${fieldError && fieldError.otp ? ' is-invalid' : ''}`}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                    disabled={submitting}
                  />
                </FormField>

                <button type="submit" className="btn btn-primary w-100" disabled={submitting}>
                  {submitting ? (<><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Verifying…</>) : 'Verify email'}
                </button>
              </form>

              <div className="text-center small mt-3">
                <button type="button" className="btn btn-link btn-sm p-0" onClick={handleResend} disabled={resending || cooldown > 0}>
                  {resending ? 'Sending…' : cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
                </button>
                <div className="mt-2"><Link to="/login">Back to sign in</Link></div>
              </div>
              {import.meta.env.DEV && (
                <p className="text-secondary small mt-3 mb-0">Development note: when the backend has no email settings, the code is printed in the backend terminal.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
