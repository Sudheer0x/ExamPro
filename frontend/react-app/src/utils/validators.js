// utils/validators.js — client-side checks that mirror the backend's rules, for fast feedback only.
// The backend validates everything again and stays the authority.

const NAME_RE = /^[\p{L}][\p{L}\s.'-]*$/u;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_RE = /^\+?[0-9]{10,15}$/;

export const normalizeEmail = (value) => String(value ?? '').trim().toLowerCase();
export const normalizeMobile = (value) => String(value ?? '').replace(/[\s-]/g, '');

export function validateEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return 'Email is required.';
  if (email.length > 150) return 'Email is too long.';
  if (!EMAIL_RE.test(email)) return 'Enter a valid email address.';
  return null;
}

export function validatePassword(value) {
  const password = String(value ?? '');
  if (!password) return 'Password is required.';
  if (password.length < 8 || password.length > 64) return 'Password must be 8 to 64 characters.';
  if (!/[A-Za-z]/.test(password)) return 'Password must contain at least one letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
  return null;
}

export function validateOtp(value) {
  return /^\d{6}$/.test(String(value ?? '').trim()) ? null : 'Enter the 6-digit code from your email.';
}

export function validateLogin({ email, password }) {
  const errors = {};
  const emailError = validateEmail(email);
  if (emailError) errors.email = emailError;
  if (!String(password ?? '')) errors.password = 'Password is required.';
  return errors;
}

/** Returns { field: message } — empty when everything looks fine. */
export function validateRegistration(values, today = new Date()) {
  const errors = {};

  const name = String(values.fullName ?? '').trim();
  if (!name) errors.fullName = 'Full name is required.';
  else if (name.length < 2 || name.length > 150) errors.fullName = 'Full name must be 2 to 150 characters.';
  else if (!NAME_RE.test(name)) errors.fullName = 'Full name can only contain letters, spaces, dots, apostrophes and hyphens.';

  const emailError = validateEmail(values.email);
  if (emailError) errors.email = emailError;

  const mobile = normalizeMobile(values.mobile);
  if (!mobile) errors.mobile = 'Mobile number is required.';
  else if (!MOBILE_RE.test(mobile)) errors.mobile = 'Enter a valid mobile number (10 to 15 digits, optional leading +).';

  const dob = String(values.dateOfBirth ?? '').trim();
  if (dob) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
    const parsed = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    const real = Boolean(parsed) && parsed.getUTCFullYear() === Number(m[1]) && parsed.getUTCMonth() === Number(m[2]) - 1 && parsed.getUTCDate() === Number(m[3]);
    if (!real) errors.dateOfBirth = 'Enter a valid date of birth.';
    else if (Number(m[1]) < 1900 || parsed >= today) errors.dateOfBirth = 'Date of birth must be in the past.';
  }

  const passwordError = validatePassword(values.password);
  if (passwordError) errors.password = passwordError;

  if (!values.confirmPassword) errors.confirmPassword = 'Please confirm your password.';
  else if (values.password !== values.confirmPassword) errors.confirmPassword = 'Passwords do not match.';

  return errors;
}

/** The exact body the backend expects — nothing else is ever sent. */
export function toRegistrationPayload(values) {
  const payload = {
    full_name: String(values.fullName).trim(),
    email: normalizeEmail(values.email),
    mobile_number: normalizeMobile(values.mobile),
    password: values.password,
  };
  const dob = String(values.dateOfBirth ?? '').trim();
  if (dob) payload.date_of_birth = dob;
  return payload;
}

/** Backend field names -> the form's field names, so server-side messages land on the right input. */
export const BACKEND_FIELD_MAP = {
  full_name: 'fullName',
  email: 'email',
  mobile_number: 'mobile',
  date_of_birth: 'dateOfBirth',
  password: 'password',
};
