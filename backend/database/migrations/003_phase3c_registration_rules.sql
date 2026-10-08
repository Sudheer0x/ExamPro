-- ==================================================================
-- Migration 003 — Phase 3C (student registration)
--
-- Problem: registrations had UNIQUE (student_id, examination_id), i.e. ONE row per student and exam EVER.
-- A student who cancelled could never register again. The real rule is "at most one ACTIVE registration
-- per student and exam" (cancelled ones are history and may repeat).
--
-- Fix, in three safe steps:
--   1. add a virtual generated column  active_flag  = 1 for active rows, NULL for cancelled rows
--   2. add UNIQUE (student_id, examination_id, active_flag)   (MySQL allows many NULLs, so many cancelled
--      rows are fine but a second active row is rejected by the database itself)
--   3. only then drop the old unique key. (The new key is created first, so the student foreign key
--      always has an index.)
--
-- No table, column or row of data is removed; the old unique key is replaced by a looser, equally
-- safe one. Safe to run twice (every step checks first). Run:  npm run migrate
-- ==================================================================

SET NAMES utf8mb4;

-- 1. generated column
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND COLUMN_NAME = 'active_flag') = 0,
  'ALTER TABLE registrations ADD COLUMN active_flag TINYINT GENERATED ALWAYS AS (IF(status = ''cancelled'', NULL, 1)) VIRTUAL AFTER status',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. one ACTIVE registration per student and exam
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND INDEX_NAME = 'uq_student_exam_active') = 0,
  'ALTER TABLE registrations ADD UNIQUE KEY uq_student_exam_active (student_id, examination_id, active_flag)',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. the old "one row ever" key is no longer wanted
SET @stmt = IF(
  (SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'registrations' AND INDEX_NAME = 'uq_student_examination') > 0,
  'ALTER TABLE registrations DROP INDEX uq_student_examination',
  'DO 0');
PREPARE s FROM @stmt; EXECUTE s; DEALLOCATE PREPARE s;
