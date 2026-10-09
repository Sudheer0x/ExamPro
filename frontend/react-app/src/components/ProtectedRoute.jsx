// components/ProtectedRoute.jsx — keeps signed-out visitors and wrong-role users out of a group of pages.
//
// This only decides what the BROWSER shows. Every API call is checked again by the backend, which is
// the real authority: changing this code cannot give anyone access to data.
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import Loading from './Loading';

export default function ProtectedRoute({ roles, loginPath = '/login' }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <Loading label="Checking your session…" fullPage />;
  if (!user) return <Navigate to={loginPath} replace state={{ from: location }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/unauthorized" replace />;
  return <Outlet />;
}
