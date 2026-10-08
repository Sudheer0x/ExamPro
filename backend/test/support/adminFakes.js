// test/support/adminFakes.js
//
// In-memory stand-ins for the Phase 3B models, the clock and withTransaction, so the real SERVICES
// and the real HTTP stack can be tested without MySQL. Each fake mimics what the real SQL does.
// (What these CANNOT prove — SQL, constraints, locking — is covered by the optional real-database
// tests in test/db/.) The harness fails loudly if a fake and its real model drift apart.

'use strict';

const BASE_EPOCH_MS = Date.UTC(2026, 9, 6, 10, 0, 0); // fake "now" = 2026-10-06 10:00:00 business time + clock.t seconds
const pad = (n) => String(n).padStart(2, '0');

function makeAdminFakes(db, clock) {
  const nowString = () => {
    const d = new Date(BASE_EPOCH_MS + clock.t * 1000);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  };
  const ids = { exam: 0, center: 0, pc: 0, slot: 0 };
  const reset = () => { ids.exam = 0; ids.center = 0; ids.pc = 0; ids.slot = 0; };
  const CREATED = '2026-10-01 00:00:00';
  const copy = (o) => (o ? { ...o } : null);
  const slotEnd = (s) => `${s.exam_date} ${s.slot_end_time}`;
  const secs = (t) => { const [h, m, s] = t.split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
  const like = (value, q) => String(value).toLowerCase().includes(String(q).toLowerCase());

  const registrationsOf = (examId) => db.registrations.filter((r) => r.examination_id === examId && r.status !== 'cancelled');
  const bookedIn = (slotId) => db.allocations.filter((a) => a.exam_slot_id === slotId && a.registration_status !== 'cancelled').length;
  const workingAt = (centerId) => db.computers.filter((p) => p.center_id === centerId && p.status !== 'maintenance').length;

  // ---------------- clock + transaction ----------------
  const clockModel = { async now() { return nowString(); } };
  const transaction = { async withTransaction(fn) { return fn({ fakeConnection: true }); } };

  // ---------------- examinations ----------------
  const examinationModel = {
    async insert(d) {
      const id = ++ids.exam;
      db.examinations.push({
        id, exam_name: d.exam_name, description: d.description, instructions: d.instructions,
        registration_start_date: d.registration_start_date, registration_end_date: d.registration_end_date,
        exam_duration_minutes: d.exam_duration_minutes, fee: d.fee, status: 'draft', created_at: CREATED, updated_at: CREATED,
      });
      return id;
    },
    async findById(id) { return copy(db.examinations.find((e) => e.id === id)); },
    async lockById(id) { return copy(db.examinations.find((e) => e.id === id)); },
    async list({ limit, offset, status, q }) {
      let rows = db.examinations.filter((e) => (!status || e.status === status) && (!q || like(e.exam_name, q)));
      const total = rows.length;
      rows = rows.slice().sort((a, b) => b.id - a.id).slice(offset, offset + limit).map((e) => ({
        ...e,
        slot_count: db.slots.filter((s) => s.examination_id === e.id).length,
        registration_count: registrationsOf(e.id).length,
      }));
      return { rows, total };
    },
    async update(id, fields) {
      const e = db.examinations.find((x) => x.id === id);
      for (const k of ['exam_name', 'description', 'instructions', 'registration_start_date', 'registration_end_date', 'exam_duration_minutes', 'fee']) {
        if (fields[k] !== undefined) e[k] = fields[k];
      }
    },
    async setStatus(id, status) { db.examinations.find((e) => e.id === id).status = status; },
    async countRegistrations(id) { return registrationsOf(id).length; },
    async getSummary(id) {
      const slots = db.slots.filter((s) => s.examination_id === id);
      return { slot_count: slots.length, total_capacity: slots.reduce((n, s) => n + s.capacity, 0), registration_count: registrationsOf(id).length };
    },
  };

  // ---------------- centers ----------------
  const centerRow = (c) => c && ({
    ...c,
    total_computers: db.computers.filter((p) => p.center_id === c.id).length,
    working_computers: workingAt(c.id),
  });
  const centerModel = {
    async insert({ center_name, address, city, state }) {
      const id = ++ids.center;
      db.centers.push({ id, center_name, address, city, state, is_active: 1, created_at: CREATED, max_capacity: 0, available_computers: 0 });
      return id;
    },
    async findById(id) { return centerRow(db.centers.find((c) => c.id === id)) || null; },
    async lockById(id) { const c = db.centers.find((x) => x.id === id); return c ? { id: c.id } : null; },
    async list({ limit, offset, city, state, is_active, q }) {
      let rows = db.centers.filter((c) =>
        (!city || c.city === city) && (!state || c.state === state) &&
        (is_active === undefined || Boolean(c.is_active) === is_active) && (!q || like(c.center_name, q)));
      const total = rows.length;
      rows = rows.slice().sort((a, b) => b.id - a.id).slice(offset, offset + limit).map(centerRow);
      return { rows, total };
    },
    async update(id, fields) {
      const c = db.centers.find((x) => x.id === id);
      for (const k of ['center_name', 'address', 'city', 'state', 'is_active']) {
        if (fields[k] !== undefined) c[k] = k === 'is_active' ? (fields[k] ? 1 : 0) : fields[k];
      }
    },
    async deleteById(id) {
      db.centers = db.centers.filter((c) => c.id !== id);
      db.computers = db.computers.filter((p) => p.center_id !== id);
    },
    async syncComputerCounts(id) {
      const c = db.centers.find((x) => x.id === id);
      c.max_capacity = db.computers.filter((p) => p.center_id === id).length;
      c.available_computers = workingAt(id);
    },
    async countSlots(id) { return db.slots.filter((s) => s.center_id === id).length; },
    async countUpcomingSlots(id, now) { return db.slots.filter((s) => s.center_id === id && slotEnd(s) > now).length; },
    async hasUpcomingAllocatedSlots(id, now) {
      return db.slots.some((s) => s.center_id === id && slotEnd(s) > now && db.allocations.some((a) => a.exam_slot_id === s.id));
    },
  };

  // ---------------- computers ----------------
  const computerModel = {
    async countByCenter(centerId) {
      const all = db.computers.filter((p) => p.center_id === centerId);
      return { total: all.length, working: all.filter((p) => p.status !== 'maintenance').length };
    },
    async listLabelsWithPrefix(centerId, prefix) {
      return db.computers.filter((p) => p.center_id === centerId && p.pc_label.toLowerCase().startsWith(prefix.toLowerCase())).map((p) => p.pc_label);
    },
    async bulkInsert(centerId, labels) {
      for (const label of labels) db.computers.push({ id: ++ids.pc, center_id: centerId, pc_label: label, status: 'available', created_at: CREATED });
    },
    async list({ centerId, status, limit, offset }) {
      const rows = db.computers.filter((p) => p.center_id === centerId && (!status || p.status === status));
      return { rows: rows.slice(offset, offset + limit).map(copy), total: rows.length };
    },
    async findById(centerId, id) { return copy(db.computers.find((p) => p.id === id && p.center_id === centerId)); },
    async setStatus(id, status) { db.computers.find((p) => p.id === id).status = status; },
    async deleteById(id) { db.computers = db.computers.filter((p) => p.id !== id); },
    async countAllocations(id) { return db.computerAllocations.filter((a) => a.computer_id === id).length; },
    async countUpcomingAllocations(id, now) {
      return db.computerAllocations.filter((a) => {
        const s = db.slots.find((x) => x.id === a.exam_slot_id);
        return a.computer_id === id && s && slotEnd(s) > now;
      }).length;
    },
  };

  // ---------------- slots ----------------
  const slotRow = (s) => {
    if (!s) return null;
    const c = db.centers.find((x) => x.id === s.center_id);
    return { ...s, center_name: c ? c.center_name : null, city: c ? c.city : null, booked_count: bookedIn(s.id) };
  };
  const slotModel = {
    async insert(d) {
      const id = ++ids.slot;
      db.slots.push({ id, examination_id: d.examination_id, center_id: d.center_id, exam_date: d.exam_date, slot_start_time: d.slot_start_time, slot_end_time: d.slot_end_time, capacity: d.capacity, created_at: CREATED });
      return id;
    },
    async findById(id) { return slotRow(db.slots.find((s) => s.id === id)); },
    async lockById(id) { return slotRow(db.slots.find((s) => s.id === id)); },
    async listByExamination({ examinationId, centerId, date }) {
      return db.slots
        .filter((s) => s.examination_id === examinationId && (!centerId || s.center_id === centerId) && (!date || s.exam_date === date))
        .sort((a, b) => (a.exam_date + a.slot_start_time).localeCompare(b.exam_date + b.slot_start_time) || a.id - b.id)
        .map(slotRow);
    },
    async listOverlapping({ centerId, date, start, end, excludeId }) {
      return db.slots
        .filter((s) => s.center_id === centerId && s.exam_date === date && secs(s.slot_start_time) < secs(end) && secs(s.slot_end_time) > secs(start) && s.id !== excludeId)
        .map(copy);
    },
    async listUpcomingByCenter(centerId, now) { return db.slots.filter((s) => s.center_id === centerId && slotEnd(s) > now).map(copy); },
    async findDuplicate({ examinationId, centerId, date, start }) {
      return copy(db.slots.find((s) => s.examination_id === examinationId && s.center_id === centerId && s.exam_date === date && s.slot_start_time === start));
    },
    async update(id, { capacity }) { db.slots.find((s) => s.id === id).capacity = capacity; },
    async deleteById(id) { db.slots = db.slots.filter((s) => s.id !== id); },
    async countAllocations(id) { return db.allocations.filter((a) => a.exam_slot_id === id).length; },
    async bookedCount(id) { return bookedIn(id); },
    async countByExamination(examId) { return db.slots.filter((s) => s.examination_id === examId).length; },
    async shortestSlotMinutes(examId) {
      const mins = db.slots.filter((s) => s.examination_id === examId).map((s) => (secs(s.slot_end_time) - secs(s.slot_start_time)) / 60);
      return mins.length ? Math.min(...mins) : null;
    },
    async countSlotsAtInactiveCenters(examId) {
      return db.slots.filter((s) => s.examination_id === examId && !(db.centers.find((c) => c.id === s.center_id) || {}).is_active).length;
    },
    async countUnfinishedSlots(examId, now) { return db.slots.filter((s) => s.examination_id === examId && slotEnd(s) > now).length; },
  };

  return {
    reset,
    nowString,
    models: {
      'models/clockModel.js': clockModel,
      'models/examinationModel.js': examinationModel,
      'models/centerModel.js': centerModel,
      'models/computerModel.js': computerModel,
      'models/slotModel.js': slotModel,
      'utils/transaction.js': transaction,
    },
  };
}

module.exports = { makeAdminFakes };
