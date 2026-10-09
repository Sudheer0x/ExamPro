// components/Footer.jsx
const YEAR = new Date().getFullYear();

export default function Footer() {
  return (
    <footer className="exampro-footer mt-5 py-4">
      <div className="container d-flex flex-wrap justify-content-between gap-2 small">
        <span><strong>ExamPro</strong> — Online Examination System</span>
        <span className="text-white-50">Academic project · © {YEAR} ExamPro</span>
      </div>
    </footer>
  );
}
