-- ==================================================================
-- Migration 002 — Phase 3B (exam setup: examinations, centers, PCs, slots)
--
-- Adds ONE column (examinations.fee), ONE unique key (exam_slots) and six CHECK
-- constraints. Nothing is dropped, no data is deleted or changed.
-- Safe to run twice: every step first checks whether it is already in place.
--
-- If existing rows already break a rule (for example two identical slots), MySQL
-- refuses that step, the runner reports it and does NOT record this migration; fix
-- the offending rows and run it again.
--
-- NOTE: MySQL older than 8.0.16 accepts CHECK constraints but silently ignores
-- them. The application validates every one of these rules too.
--
-- Run:  npm run migrate
-- ==================================================================

SET NAMES utf8mb4;

-- 1. Exam fee (0.00 = free). Needed before payments exist; existing exams get 0.00.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examinations' AND COLUMN_NAME = 'fee') = 0,
  'ALTER TABLE examinations ADD COLUMN fee DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER exam_duration_minutes',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. A center cannot have two identical slots for the same exam, date and start time.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_slots' AND INDEX_NAME = 'uq_slot_exam_center_start') = 0,
  'ALTER TABLE exam_slots ADD UNIQUE KEY uq_slot_exam_center_start (examination_id, center_id, exam_date, slot_start_time)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. A slot must end after it starts.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_slots' AND CONSTRAINT_NAME = 'chk_slot_times') = 0,
  'ALTER TABLE exam_slots ADD CONSTRAINT chk_slot_times CHECK (slot_start_time < slot_end_time)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. A slot must have at least one seat.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_slots' AND CONSTRAINT_NAME = 'chk_slot_capacity') = 0,
  'ALTER TABLE exam_slots ADD CONSTRAINT chk_slot_capacity CHECK (capacity > 0)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Registration must close after it opens.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examinations' AND CONSTRAINT_NAME = 'chk_exam_window') = 0,
  'ALTER TABLE examinations ADD CONSTRAINT chk_exam_window CHECK (registration_end_date > registration_start_date)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 6. Duration must be positive.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examinations' AND CONSTRAINT_NAME = 'chk_exam_duration') = 0,
  'ALTER TABLE examinations ADD CONSTRAINT chk_exam_duration CHECK (exam_duration_minutes > 0)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 7. The fee cannot be negative.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'examinations' AND CONSTRAINT_NAME = 'chk_exam_fee') = 0,
  'ALTER TABLE examinations ADD CONSTRAINT chk_exam_fee CHECK (fee >= 0)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 8. Working PCs can never exceed total PCs at a center.
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'exam_centers' AND CONSTRAINT_NAME = 'chk_center_counts') = 0,
  'ALTER TABLE exam_centers ADD CONSTRAINT chk_center_counts CHECK (available_computers <= max_capacity)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
