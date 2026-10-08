// src/services/centerService.js — exam centers and their PCs (admin side).
//
// The computers table is the source of truth. A PC "works" unless it is in maintenance.
// Anything that changes the PCs or the slots of a center first locks that center's row,
// so two admins cannot make capacity checks against stale numbers.

const config = require('../config/env');
const AppError = require('../utils/AppError');
const { withTransaction } = require('../utils/transaction');
const { timeToSeconds } = require('../utils/datetime');
const { worstDay } = require('./slotCapacity');
const centerModel = require('../models/centerModel');
const computerModel = require('../models/computerModel');
const slotModel = require('../models/slotModel');
const clockModel = require('../models/clockModel');

const notFound = () => new AppError('Exam center not found.', 404);
const pcNotFound = () => new AppError('Computer not found at this center.', 404);
const conflict = (message, code, details) => new AppError(message, 409, { code, ...(details ? { details } : {}) });

const serializeCenter = (c) => ({
  id: c.id,
  center_name: c.center_name,
  address: c.address,
  city: c.city,
  state: c.state,
  is_active: Boolean(c.is_active),
  total_computers: Number(c.total_computers),
  working_computers: Number(c.working_computers),
  created_at: c.created_at,
});

const serializeComputer = (p) => ({ id: p.id, center_id: p.center_id, pc_label: p.pc_label, status: p.status, created_at: p.created_at });

function definedOnly(input) {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
}

// ---------------------------------------------------------------- centers

async function create(input) {
  const id = await centerModel.insert({
    center_name: input.center_name,
    address: input.address ?? null,
    city: input.city,
    state: input.state,
  });
  return serializeCenter(await centerModel.findById(id));
}

async function list({ page, limit, city, state, is_active, q }) {
  const { rows, total } = await centerModel.list({ limit, offset: (page - 1) * limit, city, state, is_active, q });
  return { centers: rows.map(serializeCenter), page, limit, total };
}

async function get(id) {
  const center = await centerModel.findById(id);
  if (!center) throw notFound();
  const now = await clockModel.now();
  return { center: serializeCenter(center), upcoming_slot_count: await centerModel.countUpcomingSlots(id, now) };
}

async function update(id, input) {
  return withTransaction(async (conn) => {
    if (!(await centerModel.lockById(id, conn))) throw notFound();
    const changes = definedOnly(input);

    if (changes.is_active === false) {
      const now = await clockModel.now(conn);
      if (await centerModel.hasUpcomingAllocatedSlots(id, now, conn)) {
        throw conflict('Candidates are booked into upcoming slots at this center, so it cannot be deactivated.', 'CENTER_HAS_BOOKINGS');
      }
    }

    await centerModel.update(id, changes, conn);
    return serializeCenter(await centerModel.findById(id, conn));
  });
}

async function remove(id) {
  return withTransaction(async (conn) => {
    if (!(await centerModel.lockById(id, conn))) throw notFound();
    const slots = await centerModel.countSlots(id, conn);
    if (slots > 0) {
      throw conflict(`This center has ${slots} slot(s). Deactivate it instead of deleting it.`, 'CENTER_IN_USE', { slots });
    }
    await centerModel.deleteById(id, conn);
  });
}

// ---------------------------------------------------------------- computers

/** Throws unless `workingAfter` PCs can still cover the busiest upcoming slot demand at the center. */
async function assertCapacityHolds(centerId, workingAfter, now, conn) {
  const upcoming = await slotModel.listUpcomingByCenter(centerId, now, conn);
  const worst = worstDay(
    upcoming.map((s) => ({
      date: s.exam_date,
      start: timeToSeconds(s.slot_start_time),
      end: timeToSeconds(s.slot_end_time),
      capacity: Number(s.capacity),
    }))
  );
  if (worst.peak > workingAfter) {
    throw conflict(
      `Upcoming slots need up to ${worst.peak} PCs at once (on ${worst.date}); only ${workingAfter} would work after this change.`,
      'CAPACITY_BELOW_DEMAND',
      { working_after_change: workingAfter, peak_demand: worst.peak, date: worst.date }
    );
  }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function nextNumber(labels, prefix) {
  const re = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, 'i');
  let highest = 0;
  for (const label of labels) {
    const m = re.exec(label);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return highest + 1;
}

async function bulkCreateComputers(centerId, { count, prefix = 'PC-', start_number: startNumber }) {
  return withTransaction(async (conn) => {
    if (!(await centerModel.lockById(centerId, conn))) throw notFound();

    const counts = await computerModel.countByCenter(centerId, conn);
    if (counts.total + count > config.limits.maxPcsPerCenter) {
      throw conflict(
        `A center can have at most ${config.limits.maxPcsPerCenter} PCs (it has ${counts.total}).`,
        'PC_LIMIT_EXCEEDED',
        { current: counts.total, requested: count, limit: config.limits.maxPcsPerCenter }
      );
    }

    const existing = await computerModel.listLabelsWithPrefix(centerId, prefix, conn);
    const first = startNumber ?? nextNumber(existing, prefix);
    const last = first + count - 1;
    const width = Math.max(3, String(last).length);
    const labels = [];
    for (let n = first; n <= last; n += 1) labels.push(`${prefix}${String(n).padStart(width, '0')}`);

    const taken = new Set(existing.map((l) => l.toLowerCase()));
    const clashes = labels.filter((l) => taken.has(l.toLowerCase()));
    if (clashes.length) {
      throw conflict(`PC label(s) already exist at this center: ${clashes.slice(0, 5).join(', ')}.`, 'PC_LABEL_EXISTS', { clashes: clashes.slice(0, 20) });
    }

    await computerModel.bulkInsert(centerId, labels, conn);
    await centerModel.syncComputerCounts(centerId, conn);
    const center = await centerModel.findById(centerId, conn);
    return { created: count, first_label: labels[0], last_label: labels[labels.length - 1], center: serializeCenter(center) };
  });
}

async function listComputers(centerId, { page, limit, status }) {
  if (!(await centerModel.findById(centerId))) throw notFound();
  const { rows, total } = await computerModel.list({ centerId, status, limit, offset: (page - 1) * limit });
  return { computers: rows.map(serializeComputer), page, limit, total };
}

async function setComputerStatus(centerId, pcId, status) {
  return withTransaction(async (conn) => {
    if (!(await centerModel.lockById(centerId, conn))) throw notFound();
    const pc = await computerModel.findById(centerId, pcId, conn);
    if (!pc) throw pcNotFound();

    if (pc.status !== status) {
      const leavingService = pc.status !== 'maintenance' && status === 'maintenance';
      if (leavingService) {
        const now = await clockModel.now(conn);
        if ((await computerModel.countUpcomingAllocations(pcId, now, conn)) > 0) {
          throw conflict('Candidates are assigned to this PC in upcoming slots.', 'PC_IN_USE');
        }
        const counts = await computerModel.countByCenter(centerId, conn);
        await assertCapacityHolds(centerId, counts.working - 1, now, conn);
      }
      await computerModel.setStatus(pcId, status, conn);
      await centerModel.syncComputerCounts(centerId, conn);
    }

    return {
      computer: serializeComputer(await computerModel.findById(centerId, pcId, conn)),
      center: serializeCenter(await centerModel.findById(centerId, conn)),
    };
  });
}

async function deleteComputer(centerId, pcId) {
  return withTransaction(async (conn) => {
    if (!(await centerModel.lockById(centerId, conn))) throw notFound();
    const pc = await computerModel.findById(centerId, pcId, conn);
    if (!pc) throw pcNotFound();

    if ((await computerModel.countAllocations(pcId, conn)) > 0) {
      throw conflict('Candidates have been assigned to this PC, so it cannot be deleted.', 'PC_IN_USE');
    }
    if (pc.status !== 'maintenance') {
      const now = await clockModel.now(conn);
      const counts = await computerModel.countByCenter(centerId, conn);
      await assertCapacityHolds(centerId, counts.working - 1, now, conn);
    }

    await computerModel.deleteById(pcId, conn);
    await centerModel.syncComputerCounts(centerId, conn);
    return { center: serializeCenter(await centerModel.findById(centerId, conn)) };
  });
}

module.exports = {
  create, list, get, update, remove,
  bulkCreateComputers, listComputers, setComputerStatus, deleteComputer,
};
