// context/useAuth.js — how components read the signed-in user.
import { useContext } from 'react';
import { AuthContext } from './authContextObject';

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.');
  return value;
}
