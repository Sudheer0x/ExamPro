// test/support/scenario.js — a ready-made world for the student HTTP tests:
// an admin, an invigilator, a teacher, two verified students (all logged in), and one OPEN exam with one slot.
// Built through the real admin services (database faked by the harness).

'use strict';

async function buildScenario(h, { capacity = 3 } = {}) {
  const exams = require('../../src/services/examinationService');
  const centers = require('../../src/services/centerService');
  const slots = require('../../src/services/slotService');

  h.resetDb();
  await h.seedStaff({ email: 'admin@example.com', password: 'Admin1234', role: 'admin' });
  await h.seedStaff({ email: 'inv@example.com', password: 'Invig1234', role: 'invigilator' });
  await h.seedStaff({ email: 'teach@example.com', password: 'Teach1234', role: 'teacher' });
  const s1 = await h.seedStudent({ email: 'stu1@example.com', password: 'Stud1234x', fullName: 'Student One' });
  const s2 = await h.seedStudent({ email: 'stu2@example.com', password: 'Stud1234x', fullName: 'Student Two' });

  const tokens = {
    admin: (await h.loginAs('admin@example.com', 'Admin1234')).token,
    invigilator: (await h.loginAs('inv@example.com', 'Invig1234')).token,
    teacher: (await h.loginAs('teach@example.com', 'Teach1234')).token,
    student1: (await h.loginAs('stu1@example.com', 'Stud1234x')).token,
    student2: (await h.loginAs('stu2@example.com', 'Stud1234x')).token,
  };

  const exam = await exams.create({
    exam_name: 'ExamPro CBT 2026',
    description: 'Computer-based test',
    registration_start_date: '2026-10-01 09:00:00',
    registration_end_date: '2026-10-31 23:59:59',
    exam_duration_minutes: 180,
    fee: '0.00',
  });
  const center = await centers.create({ center_name: 'ExamPro Centre - Vijayawada', city: 'Vijayawada', state: 'Andhra Pradesh', address: 'MG Road' });
  await centers.bulkCreateComputers(center.id, { count: 10 });
  const slot = await slots.create(exam.id, { center_id: center.id, exam_date: '2026-12-14', slot_start_time: '09:00:00', slot_end_time: '12:30:00', capacity });
  await exams.changeStatus(exam.id, 'registration_open');

  return { tokens, studentIds: { s1, s2 }, exam, center, slot, services: { exams, centers, slots } };
}

module.exports = { buildScenario };
