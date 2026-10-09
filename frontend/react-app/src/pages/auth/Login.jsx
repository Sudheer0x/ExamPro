// pages/auth/Login.jsx — student sign-in (/login and /student/login).
import { Link, useLocation } from 'react-router-dom';
import LoginForm from '../../components/LoginForm';

export default function Login() {
  const location = useLocation();
  const verifiedEmail = location.state && location.state.verifiedEmail;
  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-7 col-lg-5">
          <div className="card shadow-sm">
            <div className="card-body p-4">
              <h1 className="h4 mb-1">Student login</h1>
              <p className="text-secondary">Sign in to find exams and manage your registrations.</p>
              <LoginForm
                accountType="student"
                initialEmail={verifiedEmail || ''}
                notice={verifiedEmail ? 'Your email is verified. You can sign in now.' : null}
                footer={
                  <>
                    <div>New to ExamPro? <Link to="/register">Create an account</Link></div>
                    <div className="mt-1">Administrator? <Link to="/admin/login">Admin login</Link></div>
                  </>
                }
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
