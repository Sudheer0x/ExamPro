// pages/NotFound.jsx — 404
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="container py-5 text-center">
      <h1 className="display-4 fw-bold">404</h1>
      <p className="lead">We could not find that page.</p>
      <Link to="/" className="btn btn-primary">Back to the home page</Link>
    </div>
  );
}
