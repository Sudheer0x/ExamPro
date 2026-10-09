// pages/Landing.jsx — public home page. Only describes what ExamPro does TODAY; later phases are marked as planned.
import { Link } from 'react-router-dom';
import { useAuth } from '../context/useAuth';
import { homePathFor } from '../utils/format';

const FEATURES = [
  { title: 'Secure student accounts', text: 'Register with your email and confirm it with a one-time code. Passwords are stored hashed and sessions expire automatically.' },
  { title: 'Find your exam', text: 'Browse examinations that are open for registration, with dates, duration and fee in one place.' },
  { title: 'Choose center and slot', text: 'Pick an exam center and a time slot and see how many seats are left before you register.' },
  { title: 'Manage your registrations', text: 'See every registration you have made and cancel it while cancellation is still allowed.' },
  { title: 'Role-based access', text: 'Students and administrators sign in separately and see only what their role allows.' },
  { title: 'Administrator tools', text: 'Administrators sign in to a protected dashboard with an overview and user management.' },
];

const PLANNED = ['Online payment of exam fees', 'Hall tickets', 'Computer-based exam delivery', 'Results'];

export default function Landing() {
  const { user, isAuthenticated } = useAuth();
  return (
    <>
      <section className="hero text-white">
        <div className="container py-5">
          <div className="row align-items-center py-lg-4">
            <div className="col-lg-7">
              <h1 className="display-5 fw-bold">ExamPro</h1>
              <p className="lead mb-4">A secure online examination platform for computer-based tests: register, verify, choose your exam center and slot, and manage your registrations.</p>
              <div className="d-flex flex-wrap gap-2">
                {isAuthenticated ? (
                  <Link className="btn btn-light btn-lg" to={homePathFor(user.role)}>Go to my dashboard</Link>
                ) : (
                  <>
                    <Link className="btn btn-light btn-lg" to="/login">Student login</Link>
                    <Link className="btn btn-outline-light btn-lg" to="/register">Student registration</Link>
                    <Link className="btn btn-link btn-lg text-white" to="/admin/login">Admin login</Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="container py-5">
        <h2 className="h4 mb-4">What you can do today</h2>
        <div className="row g-3">
          {FEATURES.map((feature) => (
            <div className="col-md-6 col-lg-4" key={feature.title}>
              <div className="card h-100 feature-card">
                <div className="card-body">
                  <h3 className="h6">{feature.title}</h3>
                  <p className="text-secondary mb-0">{feature.text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="card mt-5 border-0 bg-light">
          <div className="card-body">
            <h2 className="h6">Planned for later releases</h2>
            <p className="text-secondary mb-2">These are not available yet:</p>
            <div className="d-flex flex-wrap gap-2">
              {PLANNED.map((item) => <span key={item} className="badge text-bg-secondary">{item}</span>)}
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
