// services/authService.js — authentication calls. Components never call Axios directly.

import { api, refreshAccessToken, setAccessToken, clearSession, sessionHint } from './api';

export async function registerStudent(payload) {
  const { data } = await api.post('/auth/register', payload);
  return data;
}

export async function verifyOtp(email, otp) {
  const { data } = await api.post('/auth/verify-otp', { email, otp });
  return data;
}

/** Asks for a fresh code. The backend answers the same way whether or not the email exists. */
export async function resendOtp(email) {
  const { data } = await api.post('/auth/send-otp', { email });
  return data;
}

async function login(email, password, accountType) {
  const { data } = await api.post('/auth/login', { email, password, account_type: accountType });
  setAccessToken(data.data.accessToken); // memory only; the refresh token arrives as an HttpOnly cookie
  sessionHint.set();
  return data.data.user;
}

export const loginStudent = (email, password) => login(email, password, 'student');
export const loginAdmin = (email, password) => login(email, password, 'staff');

/** Page reload: trade the HttpOnly cookie for a new access token. Resolves the user. */
export async function restoreSession() {
  const { user } = await refreshAccessToken();
  sessionHint.set();
  return user;
}

export async function getCurrentUser() {
  const { data } = await api.get('/auth/me');
  return data.data.user;
}

export async function getStudentProfile() {
  const { data } = await api.get('/student/profile');
  return data.data;
}

/** Revokes the refresh token on the server, then forgets everything locally (even if the call fails). */
export async function logout() {
  try {
    await api.post('/auth/logout');
  } catch {
    /* the local session is cleared below regardless */
  } finally {
    clearSession();
  }
}
