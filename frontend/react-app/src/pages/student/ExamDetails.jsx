// pages/student/ExamDetails.jsx — one exam: details, then  center -> slot -> review -> register.
//
// Everything shown comes from the backend (seats, fees, whether registration is open). The only thing sent
// when registering is the chosen slot_id; the student is identified by the login on the server.
// Paid exams: there is NO payment step yet. The seat is held with status "Payment pending", and the screen says so.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useResource } from '../../hooks/useResource';
import { getExam, getExamSlots } from '../../services/examService';
import { createRegistration } from '../../services/registrationService';
import { isStaleDataError, toApiError } from '../../utils/errors';
import { formatDate, formatDateTime, formatDuration, formatFee, formatTimeRange, isFree } from '../../utils/format';
import ConfirmDialog from '../../components/ConfirmDialog';
import ErrorAlert from '../../components/ErrorAlert';
import Loading from '../../components/Loading';
import StatusBadge from '../../components/StatusBadge';

const NO_SLOTS = [];

function groupByCenter(slots) {
  const byCenter = new Map();
  for (const slot of slots) {
    if (!byCenter.has(slot.center_id)) {
      byCenter.set(slot.center_id, {
        center_id: slot.center_id,
        center_name: slot.center_name,
        city: slot.city,
        state: slot.state,
        address: slot.address,
        slots: [],
        seatsLeft: 0,
      });
    }
    const group = byCenter.get(slot.center_id);
    group.slots.push(slot);
    group.seatsLeft += slot.seats_left;
  }
  return Array.from(byCenter.values());
}

function Steps({ current }) {
  const steps = ['Choose a center', 'Choose a slot', 'Review and register'];
  return (
    <ol className="wizard-steps list-unstyled d-flex flex-wrap gap-2 mb-3">
      {steps.map((label, index) => {
        const number = index + 1;
        const state = number < current ? 'done' : number === current ? 'current' : 'todo';
        return <li key={label} className={`wizard-step ${state}`}><span className="wizard-number">{number}</span>{label}</li>;
      })}
    </ol>
  );
}

export default function ExamDetails() {
  const { id } = useParams();
  const examRes = useResource(() => getExam(id), ['exam', id]);
  const slotsRes = useResource(() => getExamSlots(id), ['exam-slots', id]);

  const [selection, setSelection] = useState({ forExam: id, centerId: null, slotId: null });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registerError, setRegisterError] = useState(null);
  const [created, setCreated] = useState(null);

  const exam = examRes.data ? examRes.data.examination : null;
  const slots = slotsRes.data ? slotsRes.data.slots : NO_SLOTS;
  const centers = useMemo(() => groupByCenter(slots), [slots]);

  const current = selection.forExam === id ? selection : { centerId: null, slotId: null };
  const selectedCenter = centers.find((c) => c.center_id === current.centerId) || null;
  const selectedSlot = selectedCenter ? selectedCenter.slots.find((s) => s.id === current.slotId) || null : null;
  const step = !selectedCenter ? 1 : !selectedSlot ? 2 : 3;

  const alreadyRegistered = Boolean(exam && exam.my_registration);
  const canChoose = Boolean(exam && exam.can_register && !alreadyRegistered);

  function reloadAll() {
    examRes.reload();
    slotsRes.reload();
  }
  const chooseCenter = (centerId) => setSelection({ forExam: id, centerId, slotId: null });
  const chooseSlot = (slotId) => setSelection({ forExam: id, centerId: current.centerId, slotId });
  const clearSelection = () => setSelection({ forExam: id, centerId: null, slotId: null });

  async function register() {
    if (submitting || !selectedSlot) return;
    setConfirmOpen(false);
    setSubmitting(true);
    setRegisterError(null);
    try {
      const registration = await createRegistration(selectedSlot.id); // body is { slot_id } only
      setCreated(registration);
      clearSelection();
      reloadAll();
    } catch (err) {
      const apiError = toApiError(err);
      setRegisterError(apiError);
      if (isStaleDataError(apiError)) {
        clearSelection(); // what the student was looking at is out of date: reload it
        reloadAll();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleRegisterClick() {
    if (!exam) return;
    if (isFree(exam.fee)) register();
    else setConfirmOpen(true); // paid exam: explain what happens first
  }

  if (examRes.loading && !exam) return <div className="container py-4"><Loading label="Loading exam…" /></div>;
  if (examRes.error) {
    return (
      <div className="container py-4">
        <ErrorAlert error={examRes.error} onRetry={examRes.error.status === 404 ? undefined : examRes.reload} />
        <Link to="/student/exams">Back to exams</Link>
      </div>
    );
  }
  if (!exam) return null;

  const paid = !isFree(exam.fee);

  return (
    <div className="container py-4">
      <nav aria-label="breadcrumb"><ol className="breadcrumb small">
        <li className="breadcrumb-item"><Link to="/student/exams">Available exams</Link></li>
        <li className="breadcrumb-item active" aria-current="page">{exam.exam_name}</li>
      </ol></nav>

      <div className="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">
        <h1 className="h3 mb-0">{exam.exam_name}</h1>
        <StatusBadge kind="state" value={exam.registration_state} />
      </div>

      <div className="row g-3 mb-4">
        <div className="col-lg-8">
          <div className="card h-100"><div className="card-body">
            {exam.description && <p>{exam.description}</p>}
            <dl className="row mb-0">
              <dt className="col-sm-4 text-secondary fw-normal">Duration</dt><dd className="col-sm-8">{formatDuration(exam.exam_duration_minutes)}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Fee</dt><dd className="col-sm-8">{formatFee(exam.fee)}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Registration opens</dt><dd className="col-sm-8">{formatDateTime(exam.registration_start_date)}</dd>
              <dt className="col-sm-4 text-secondary fw-normal">Registration closes</dt><dd className="col-sm-8">{formatDateTime(exam.registration_end_date)}</dd>
            </dl>
          </div></div>
        </div>
        <div className="col-lg-4">
          <div className="card h-100"><div className="card-body">
            <h2 className="h6">Instructions</h2>
            {exam.instructions ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{exam.instructions}</div> : <p className="small text-secondary mb-0">No instructions have been published.</p>}
          </div></div>
        </div>
      </div>

      {created && (
        <div className="alert alert-success" role="status">
          <h2 className="h5">{created.status === 'completed' ? 'Registration complete' : 'Seat reserved — payment pending'}</h2>
          <dl className="row mb-2">
            <dt className="col-sm-3">Registration ID</dt><dd className="col-sm-9">{created.registration_id}</dd>
            <dt className="col-sm-3">Application ID</dt><dd className="col-sm-9">{created.application_id}</dd>
            <dt className="col-sm-3">Exam</dt><dd className="col-sm-9">{created.examination.exam_name}</dd>
            <dt className="col-sm-3">Center</dt><dd className="col-sm-9">{created.center ? `${created.center.center_name}, ${created.center.city}` : '—'}</dd>
            <dt className="col-sm-3">Slot</dt><dd className="col-sm-9">{created.slot ? `${formatDate(created.slot.exam_date)}, ${formatTimeRange(created.slot.slot_start_time, created.slot.slot_end_time)}` : '—'}</dd>
            <dt className="col-sm-3">Status</dt><dd className="col-sm-9"><StatusBadge kind="registration" value={created.status} /></dd>
          </dl>
          {created.status === 'pending_payment' && <p className="mb-2">Online payment is not available yet. Your seat is held and the payment step will be added in a later update.</p>}
          <Link to="/student/registrations" className="btn btn-success btn-sm">Go to my registrations</Link>
        </div>
      )}

      {alreadyRegistered && !created && (
        <div className="alert alert-info d-flex flex-wrap justify-content-between align-items-center gap-2" role="status">
          <span>You are registered for this exam (<strong>{exam.my_registration.registration_id}</strong>, <StatusBadge kind="registration" value={exam.my_registration.status} />).</span>
          <Link to="/student/registrations" className="btn btn-sm btn-outline-primary">View my registrations</Link>
        </div>
      )}

      {!exam.can_register && !alreadyRegistered && (
        <div className="alert alert-secondary" role="status">
          {exam.registration_state === 'upcoming' ? `Registration opens on ${formatDateTime(exam.registration_start_date)}.` : 'Registration is closed for this exam.'}
        </div>
      )}

      <ErrorAlert error={registerError} className="mb-3" />

      <h2 className="h5 mt-4">Centers and slots</h2>
      {slotsRes.loading && !slotsRes.data && <Loading label="Loading slots…" />}
      <ErrorAlert error={slotsRes.error} onRetry={slotsRes.reload} />
      {slotsRes.data && centers.length === 0 && <p className="text-secondary">There are no upcoming slots for this exam.</p>}

      {canChoose && centers.length > 0 && <Steps current={step} />}

      {centers.length > 0 && (
        <div className="row g-3">
          <div className="col-lg-5">
            <h3 className="h6 text-secondary">Centers</h3>
            <div className="list-group">
              {centers.map((center) => {
                const active = selectedCenter && selectedCenter.center_id === center.center_id;
                return (
                  <button
                    key={center.center_id}
                    type="button"
                    className={`list-group-item list-group-item-action ${active ? 'active' : ''}`}
                    onClick={() => chooseCenter(center.center_id)}
                    disabled={!canChoose || submitting}
                    aria-pressed={Boolean(active)}
                  >
                    <div className="d-flex justify-content-between gap-2">
                      <span className="fw-semibold">{center.center_name}</span>
                      <span className="small">{center.seatsLeft} seats left</span>
                    </div>
                    <div className="small">{[center.city, center.state].filter(Boolean).join(', ')}</div>
                    {center.address && <div className="small opacity-75">{center.address}</div>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="col-lg-7">
            <h3 className="h6 text-secondary">{canChoose ? (selectedCenter ? `Slots at ${selectedCenter.center_name}` : 'Choose a center to see its slots') : 'Slots'}</h3>
            {(canChoose ? selectedCenter && [selectedCenter] : centers) && (
              <div className="list-group">
                {(canChoose ? [selectedCenter] : centers).filter(Boolean).flatMap((center) =>
                  center.slots.map((slot) => {
                    const active = selectedSlot && selectedSlot.id === slot.id;
                    return (
                      <button
                        key={slot.id}
                        type="button"
                        className={`list-group-item list-group-item-action d-flex justify-content-between align-items-center gap-2 ${active ? 'active' : ''}`}
                        onClick={() => chooseSlot(slot.id)}
                        disabled={!canChoose || slot.is_full || submitting}
                        aria-pressed={Boolean(active)}
                      >
                        <span>
                          <span className="fw-semibold">{formatDate(slot.exam_date)}</span>, {formatTimeRange(slot.slot_start_time, slot.slot_end_time)}
                          {!canChoose && <span className="small d-block opacity-75">{center.center_name}</span>}
                        </span>
                        {slot.is_full ? <span className="badge text-bg-danger">Full</span> : <span className="badge text-bg-light text-dark">{slot.seats_left} of {slot.capacity} seats left</span>}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {canChoose && selectedSlot && selectedCenter && (
        <div className="card border-primary mt-4">
          <div className="card-header bg-primary text-white">Registration summary</div>
          <div className="card-body">
            <dl className="row mb-3">
              <dt className="col-sm-3">Exam</dt><dd className="col-sm-9">{exam.exam_name}</dd>
              <dt className="col-sm-3">Center</dt><dd className="col-sm-9">{selectedCenter.center_name}{selectedCenter.address ? `, ${selectedCenter.address}` : ''}, {[selectedCenter.city, selectedCenter.state].filter(Boolean).join(', ')}</dd>
              <dt className="col-sm-3">Slot</dt><dd className="col-sm-9">{formatDate(selectedSlot.exam_date)}, {formatTimeRange(selectedSlot.slot_start_time, selectedSlot.slot_end_time)}</dd>
              <dt className="col-sm-3">Fee</dt><dd className="col-sm-9">{formatFee(exam.fee)}</dd>
            </dl>
            {paid ? (
              <div className="alert alert-warning">
                <strong>Payment is not available yet.</strong> If you continue, your seat is held with the status <em>Payment pending</em>. You can cancel it later from My registrations. Online payment will be added in a later update.
              </div>
            ) : (
              <p className="text-secondary">This exam is free. Your registration will be completed immediately.</p>
            )}
            <div className="d-flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" onClick={handleRegisterClick} disabled={submitting}>
                {submitting ? (<><span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />Registering…</>) : paid ? 'Proceed to Payment' : 'Complete registration'}
              </button>
              <button type="button" className="btn btn-outline-secondary" onClick={clearSelection} disabled={submitting}>Start over</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Reserve your seat?"
        confirmLabel="Reserve seat"
        busy={submitting}
        onConfirm={register}
        onCancel={() => setConfirmOpen(false)}
      >
        <p>Online payment is not available yet, so this step <strong>reserves your seat</strong> with the status <em>Payment pending</em>. Nothing is charged.</p>
        <p className="mb-0">You can cancel the registration from My registrations while cancellation is allowed.</p>
      </ConfirmDialog>
    </div>
  );
}
