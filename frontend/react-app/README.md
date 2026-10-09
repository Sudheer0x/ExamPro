# ExamPro — frontend

React 19 + Vite + React Router + Axios + Bootstrap 5. It is only a client: the backend decides who may do what.

## Run it

```powershell
# terminal 1 — backend (from ...\exampro\backend)
npm run dev

# terminal 2 — frontend (from ...\exampro\frontend\react-app)
npm install        # first time only
npm run dev        # http://localhost:5173
```

Checks: `npm run lint`, `npm run build`, and the pure-function tests `node --test "tests/*.test.js"` (no extra packages).

## How it talks to the backend

* Requests go to `/api`; the Vite dev server forwards them to the backend (`VITE_PROXY_TARGET`, default `http://localhost:5000`).
  See `.env.example` for talking to the backend directly.
* The short-lived **access token** is kept in memory only (`src/services/api.js`), sent as `Authorization: Bearer ...`.
* The **refresh token** is an HttpOnly cookie; the browser sends it, JavaScript never sees it. After a page reload the app
  asks `POST /api/auth/refresh` for a new access token. A 401 triggers ONE refresh and ONE retry (concurrent requests share the
  refresh), so there are no loops. If refresh fails the user is signed out.
* Nothing secret is stored: no password, no OTP, no refresh token. The only thing in `localStorage` is the flag
  `exampro.hasSession` (a hint that a refresh is worth trying).

## Structure

```
src/
  components/   Navbar, Footer, Loading, ErrorAlert, FormField, Pagination, StatusBadge, ConfirmDialog, LoginForm,
                ProtectedRoute, GuestOnly
  context/      AuthContext (provider), useAuth, authContextObject
  hooks/        useResource (loading / error / reload for a screen)
  pages/        Landing, NotFound, Unauthorized, auth/*, student/*, admin/*
  routes/       AppRoutes — add future modules here
  services/     api (Axios + refresh), authService, examService, registrationService, adminService
  utils/        errors (friendly messages), format (dates, fees), validators (client-side checks)
tests/          node:test unit tests for utils
```

## Pages

Public: `/`, `/register`, `/verify-otp`, `/login` (= `/student/login`), `/admin/login`.
Student (role STUDENT): `/student/dashboard`, `/profile`, `/exams`, `/exams/:id`, `/registrations`.
Admin (role ADMIN): `/admin/dashboard`, `/admin/users`.

## Not built yet (later phases)

Payment, hall tickets, the exam itself, results, invigilator screens, and admin screens for examinations / centers /
computers / slots (the backend for those already exists). Paid exams currently hold the seat as "Payment pending".
