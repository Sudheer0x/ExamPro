// routes/AppRoutes.jsx — every page of the site. Add future modules (payment, hall ticket, exam, results,
// invigilator...) as new <Route> groups here, behind the same ProtectedRoute.
import { Navigate, Route, Routes } from 'react-router-dom';
import GuestOnly from '../components/GuestOnly';
import ProtectedRoute from '../components/ProtectedRoute';
import Landing from '../pages/Landing';
import NotFound from '../pages/NotFound';
import Unauthorized from '../pages/Unauthorized';
import Login from '../pages/auth/Login';
import Register from '../pages/auth/Register';
import VerifyOtp from '../pages/auth/VerifyOtp';
import AdminLogin from '../pages/admin/AdminLogin';
import AdminDashboard from '../pages/admin/AdminDashboard';
import AdminUsers from '../pages/admin/AdminUsers';
import StudentDashboard from '../pages/student/StudentDashboard';
import StudentProfile from '../pages/student/StudentProfile';
import Exams from '../pages/student/Exams';
import ExamDetails from '../pages/student/ExamDetails';
import MyRegistrations from '../pages/student/MyRegistrations';

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />

      {/* signed-out visitors only */}
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/student/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route path="/admin/login" element={<GuestOnly><AdminLogin /></GuestOnly>} />
      <Route path="/verify-otp" element={<VerifyOtp />} />

      {/* students */}
      <Route element={<ProtectedRoute roles={['STUDENT']} loginPath="/student/login" />}>
        <Route path="/student/dashboard" element={<StudentDashboard />} />
        <Route path="/student/profile" element={<StudentProfile />} />
        <Route path="/student/exams" element={<Exams />} />
        <Route path="/student/exams/:id" element={<ExamDetails />} />
        <Route path="/student/registrations" element={<MyRegistrations />} />
      </Route>

      {/* administrators */}
      <Route element={<ProtectedRoute roles={['ADMIN']} loginPath="/admin/login" />}>
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
        <Route path="/admin/users" element={<AdminUsers />} />
      </Route>

      <Route path="/student" element={<Navigate to="/student/dashboard" replace />} />
      <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
      <Route path="/unauthorized" element={<Unauthorized />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
