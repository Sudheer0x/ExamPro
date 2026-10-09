// services/api.js — the ONE place that talks HTTP to the backend.
//
// Security model (matches the backend):
//   * The short-lived ACCESS token lives only in this module's memory. It is never written to localStorage,
//     sessionStorage or a cookie, so a page reload simply asks the backend for a new one.
//   * The REFRESH token is an HttpOnly cookie. JavaScript cannot see it and must not try; the browser sends
//     it by itself because of `withCredentials: true`.
//   * On a 401 the request is retried ONCE after a refresh. Concurrent 401s share ONE refresh call
//     (the backend treats a re-used refresh token as theft and ends the session, so two parallel
//     refreshes would log the user out).

import axios from 'axios';

// '/api' goes through the Vite dev-server proxy (see vite.config.js). Set VITE_API_BASE_URL to a full URL
// such as http://localhost:5000/api to talk to the backend directly (then the backend must allow this origin in CORS).
const baseURL = import.meta.env.VITE_API_BASE_URL || '/api';

export const api = axios.create({ baseURL, withCredentials: true, timeout: 20000 });
const refreshClient = axios.create({ baseURL, withCredentials: true, timeout: 20000 }); // no interceptors: cannot loop

// ---------------------------------------------------------------- access token (memory only)
let accessToken = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (token) => { accessToken = token || null; };

// ---------------------------------------------------------------- "a session may exist" hint
// A plain flag, NOT a credential. It only lets a first-time visitor skip a pointless refresh call
// (which would show up as a 401 in the browser console).
const HINT_KEY = 'exampro.hasSession';
export const sessionHint = {
  has() {
    try { return window.localStorage.getItem(HINT_KEY) === '1'; } catch { return false; }
  },
  set() {
    try { window.localStorage.setItem(HINT_KEY, '1'); } catch { /* storage unavailable: harmless */ }
  },
  clear() {
    try { window.localStorage.removeItem(HINT_KEY); } catch { /* storage unavailable: harmless */ }
  },
};

export function clearSession() {
  accessToken = null;
  sessionHint.clear();
}

// ---------------------------------------------------------------- failure notification
let authFailureHandler = null;
export function setAuthFailureHandler(handler) { authFailureHandler = handler; }

// ---------------------------------------------------------------- single-flight refresh
let refreshPromise = null;

/** Asks the backend for a new access token using the HttpOnly cookie. Resolves { accessToken, user }. */
export function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshClient
      .post('/auth/refresh')
      .then((response) => {
        const data = response.data.data;
        setAccessToken(data.accessToken);
        return data;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

// ---------------------------------------------------------------- interceptors
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// A 401 from these means "wrong credentials / bad code", not "expired session": never try to refresh for them.
const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/verify-otp', '/auth/send-otp', '/auth/refresh', '/auth/logout'];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response && error.response.status;

    if (status !== 401 || !original || original._retried || NO_REFRESH.some((path) => (original.url || '').startsWith(path))) {
      return Promise.reject(error);
    }

    original._retried = true; // at most ONE retry per request: no loops
    try {
      const { accessToken: fresh } = await refreshAccessToken();
      original.headers.Authorization = `Bearer ${fresh}`;
      return api(original);
    } catch {
      clearSession();
      if (authFailureHandler) authFailureHandler();
      return Promise.reject(error);
    }
  }
);
