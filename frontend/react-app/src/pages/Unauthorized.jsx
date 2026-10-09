// pages/Unauthorized.jsx — 403: signed in, but this area belongs to another role.
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { homePathFor } from '../utils/format';

export default function Unauthorized() {
  const { user } = useAuth();
  return (
    <div className="container py-5 text-center">
      <h1 className="display-4 fw-bold">403</h1>
      <p className="lead">You do not have access to that page.</p>
      <p className="text-secondary">Your account type cannot open this area.</p>
      {user ? <Link to={homePathFor(user.role)} className="btn btn-primary">Go to my dashboard</Link> : <Link to="/login" className="btn btn-primary">Sign in</Link>}
    </div>
  );
}
