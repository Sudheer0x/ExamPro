// components/Navbar.jsx — ExamPro top bar. Links depend on who is signed in (the backend still enforces access).
import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { homePathFor, roleLabel } from '../utils/format';

const STUDENT_LINKS = [
  ['/student/dashboard', 'Dashboard'],
  ['/student/exams', 'Available exams'],
  ['/student/registrations', 'My registrations'],
  ['/student/profile', 'Profile'],
];
const ADMIN_LINKS = [
  ['/admin/dashboard', 'Dashboard'],
  ['/admin/users', 'Users'],
];

const navClass = ({ isActive }) => `nav-link${isActive ? ' active fw-semibold' : ''}`;

export default function Navbar() {
  const { user, isAuthenticated, loading, logoutUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const links = user && user.role === 'STUDENT' ? STUDENT_LINKS : user && user.role === 'ADMIN' ? ADMIN_LINKS : [];

  async function handleLogout() {
    if (busy) return;
    setBusy(true);
    try {
      await logoutUser();
    } finally {
      setBusy(false);
      setOpen(false);
      navigate('/', { replace: true });
    }
  }

  return (
    <nav className="navbar navbar-expand-lg navbar-dark exampro-navbar sticky-top">
      <div className="container">
        <Link className="navbar-brand fw-bold d-flex align-items-center gap-2" to={isAuthenticated ? homePathFor(user.role) : '/'} onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">E</span>
          ExamPro
        </Link>
        <button className="navbar-toggler" type="button" aria-controls="main-nav" aria-expanded={open} aria-label="Toggle navigation" onClick={() => setOpen((v) => !v)}>
          <span className="navbar-toggler-icon" />
        </button>
        <div className={`collapse navbar-collapse${open ? ' show' : ''}`} id="main-nav">
          <ul className="navbar-nav me-auto mb-2 mb-lg-0">
            {links.map(([to, label]) => (
              <li className="nav-item" key={to}>
                <NavLink className={navClass} to={to} onClick={() => setOpen(false)}>{label}</NavLink>
              </li>
            ))}
          </ul>
          <div className="d-flex flex-wrap align-items-center gap-2">
            {loading ? null : isAuthenticated ? (
              <>
                <span className="text-white-50 small me-1">
                  {user.full_name || user.email} <span className="badge text-bg-light text-dark ms-1">{roleLabel(user.role)}</span>
                </span>
                <button type="button" className="btn btn-outline-light btn-sm" onClick={handleLogout} disabled={busy}>
                  {busy ? 'Signing out…' : 'Logout'}
                </button>
              </>
            ) : (
              <>
                <Link className="btn btn-outline-light btn-sm" to="/login" onClick={() => setOpen(false)}>Student login</Link>
                <Link className="btn btn-light btn-sm" to="/register" onClick={() => setOpen(false)}>Register</Link>
                <Link className="btn btn-link btn-sm text-white-50" to="/admin/login" onClick={() => setOpen(false)}>Admin</Link>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}
