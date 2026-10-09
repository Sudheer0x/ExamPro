// pages/admin/AdminLogin.jsx — administrator sign-in (/admin/login). Uses the same backend login as students.
import { Link } from 'react-router-dom';
import LoginForm from '../../components/LoginForm';

export default function AdminLogin() {
  return (
    <div className="container py-5">
      <div className="row justify-content-center">
        <div className="col-md-7 col-lg-5">
          <div className="card shadow-sm border-danger-subtle">
            <div className="card-body p-4">
              <h1 className="h4 mb-1">Administrator login</h1>
              <p className="text-secondary">For ExamPro staff. Student accounts cannot sign in here.</p>
              <LoginForm
                accountType="staff"
                allowedRoles={['ADMIN']}
                footer={<div>Student? <Link to="/login">Student login</Link></div>}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
