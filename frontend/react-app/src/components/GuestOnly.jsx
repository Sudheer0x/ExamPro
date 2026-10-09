// components/GuestOnly.jsx — login / register pages are for signed-out visitors; signed-in users go to their home.
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { homePathFor } from '../utils/format';
import Loading from './Loading';

export default function GuestOnly({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" fullPage />;
  if (user) {
    const target = location.state && location.state.from && location.state.from.pathname;
    return <Navigate to={target || homePathFor(user.role)} replace />;
  }
  return children;
}
