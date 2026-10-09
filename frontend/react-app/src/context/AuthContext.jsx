// context/AuthContext.jsx — who is signed in.
//
//   user             { id, full_name, email, role, ... } or null (comes from the backend, never from the browser)
//   loading          true only while a returning visitor's session is being restored after a page reload
//   isAuthenticated  Boolean(user)
//   login()          signs in through the real backend
//   logoutUser()     revokes the refresh token on the server and clears local state
//   checkAuth()      asks the backend again who is signed in (via the HttpOnly refresh cookie)
//
// The access token itself lives in services/api.js (memory only). The refresh token is an HttpOnly cookie
// that this code never touches.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AuthContext } from './authContextObject';
import * as authService from '../services/authService';
import { clearSession, sessionHint, setAuthFailureHandler } from '../services/api';
import { makeApiError } from '../utils/errors';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only visitors who signed in before have anything to restore; everybody else starts "ready" at once.
  const [loading, setLoading] = useState(() => sessionHint.has());

  useEffect(() => {
    // api.js calls this when a request failed with 401 and refreshing did not help: the session is over.
    setAuthFailureHandler(() => setUser(null));

    if (!sessionHint.has()) return undefined;

    let cancelled = false;
    authService
      .restoreSession() // shared single request: React StrictMode's double effect cannot cause two refreshes
      .then((restored) => { if (!cancelled) setUser(restored); })
      .catch((err) => {
        // Only forget the session if the backend said it is invalid; a network error keeps the hint.
        if (err && err.response && err.response.status === 401) clearSession();
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      setAuthFailureHandler(null);
    };
  }, []);

  const login = useCallback(async ({ email, password, accountType = 'student', allowedRoles }) => {
    const signedIn =
      accountType === 'staff' ? await authService.loginAdmin(email, password) : await authService.loginStudent(email, password);

    if (allowedRoles && !allowedRoles.includes(signedIn.role)) {
      await authService.logout(); // this screen is not for that kind of account: undo the session at once
      throw makeApiError('This account does not have access to this area.', { status: 403, code: 'WRONG_ROLE' });
    }
    setUser(signedIn);
    return signedIn;
  }, []);

  const logoutUser = useCallback(async () => {
    await authService.logout();
    setUser(null);
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const restored = await authService.restoreSession();
      setUser(restored);
      return restored;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, isAuthenticated: Boolean(user), login, logoutUser, checkAuth }),
    [user, loading, login, logoutUser, checkAuth]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
