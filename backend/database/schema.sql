-- ==================================================================
-- ExamPro — Centralized Computer-Based Examination Management System
-- MySQL Database Schema
-- ==================================================================
-- How to load this:
--   mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS exampro_db;"
--   mysql -u root -p exampro_db < backend/database/schema.sql
-- ==================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ------------------------------------------------------------------
-- 1. USERS  (staff accounts only: admin / teacher(examiner) / invigilator)
--    Students are NOT stored here — see the `students` table below,
--    since they register/authenticate differently (Registration ID +
--    Hall Ticket + Password, rather than an email/password login).
-- ------------------------------------------------------------------
CREATE TABLE users (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name       VARCHAR(150)        NOT NULL,
    email           VARCHAR(150)        NOT NULL UNIQUE,
    password_hash   VARCHAR(255)        NOT NULL,
    role            ENUM('admin', 'teacher', 'invigilator') NOT NULL,
    is_active       TINYINT(1)          NOT NULL DEFAULT 1,
    created_at      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP           NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_users_role (role)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 2. STUDENTS
-- ------------------------------------------------------------------
CREATE TABLE students (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name           VARCHAR(150)    NOT NULL,
    email               VARCHAR(150)    NOT NULL UNIQUE,
    mobile_number       VARCHAR(20)     NOT NULL,
    date_of_birth       DATE            NULL,
    gender              ENUM('male', 'female', 'other', 'prefer_not_to_say') NULL,
    address             TEXT            NULL,
    id_proof_type       VARCHAR(50)     NULL,   -- e.g. Aadhaar, Passport, Voter ID
    id_proof_number     VARCHAR(50)     NULL,
    email_verified      TINYINT(1)      NOT NULL DEFAULT 0,
    password_hash       VARCHAR(255)    NULL,   -- set once registration completes
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_students_email (email)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 3. EMAIL OTPS  (used during registration email verification)
-- ------------------------------------------------------------------
CREATE TABLE email_otps (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(150)    NOT NULL,
    otp_code        VARCHAR(255)    NOT NULL,   -- stores a hash of the OTP, never the plain code
    purpose         VARCHAR(50)     NOT NULL DEFAULT 'registration',
    attempts        INT UNSIGNED    NOT NULL DEFAULT 0,
    is_verified     TINYINT(1)      NOT NULL DEFAULT 0,
    expires_at      DATETIME        NOT NULL,
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_email_otps_email (email),
    INDEX idx_email_otps_expires (expires_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 3b. REFRESH TOKENS  (Phase 2 — revocable login sessions; one owner: a staff user OR a student)
-- ------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED    NULL,
    student_id  INT UNSIGNED    NULL,
    token_hash  CHAR(64)        NOT NULL UNIQUE,
    expires_at  DATETIME        NOT NULL,
    revoked_at  DATETIME        NULL,
    created_at  TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_rt_user    FOREIGN KEY (user_id)    REFERENCES users(id)    ON DELETE CASCADE,
    CONSTRAINT fk_rt_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT chk_rt_one_owner CHECK ((user_id IS NULL) <> (student_id IS NULL)),
    INDEX idx_rt_user (user_id),
    INDEX idx_rt_student (student_id),
    INDEX idx_rt_expires (expires_at)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 4. EXAMINATIONS  (an admin-defined exam, e.g. "ExamPro Aptitude Test 2026")
-- ------------------------------------------------------------------
CREATE TABLE examinations (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    exam_name               VARCHAR(200)    NOT NULL,
    description             TEXT            NULL,
    registration_start_date DATETIME        NOT NULL,
    registration_end_date   DATETIME        NOT NULL,
    exam_duration_minutes   INT UNSIGNED    NOT NULL,
    fee                     DECIMAL(10,2)   NOT NULL DEFAULT 0.00,   -- Phase 3B (migration 002); 0.00 = free
    instructions            TEXT            NULL,
    status                  ENUM('draft', 'registration_open', 'registration_closed', 'scheduled', 'completed')
                            NOT NULL DEFAULT 'draft',
    created_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_examinations_status (status),
    CONSTRAINT chk_exam_window   CHECK (registration_end_date > registration_start_date),   -- Phase 3B
    CONSTRAINT chk_exam_duration CHECK (exam_duration_minutes > 0),
    CONSTRAINT chk_exam_fee      CHECK (fee >= 0)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 5. REGISTRATIONS  (one student registering for one examination)
-- ------------------------------------------------------------------
CREATE TABLE registrations (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id          INT UNSIGNED    NOT NULL,
    examination_id      INT UNSIGNED    NOT NULL,
    registration_id     VARCHAR(30)     NOT NULL UNIQUE,   -- e.g. EXP20260001
    application_id      VARCHAR(30)     NOT NULL UNIQUE,
    status              ENUM('pending_payment', 'completed', 'cancelled') NOT NULL DEFAULT 'pending_payment',
    -- Phase 3C (migration 003): 1 while the registration is active, NULL once cancelled.
    active_flag         TINYINT         GENERATED ALWAYS AS (IF(status = 'cancelled', NULL, 1)) VIRTUAL,
    registered_at       TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- At most ONE active registration per student and exam (cancelled rows are history and may repeat).
    UNIQUE KEY uq_student_exam_active (student_id, examination_id, active_flag),
    CONSTRAINT fk_reg_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    CONSTRAINT fk_reg_examination FOREIGN KEY (examination_id) REFERENCES examinations(id) ON DELETE RESTRICT,
    INDEX idx_registrations_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 6. PAYMENTS
-- ------------------------------------------------------------------
CREATE TABLE payments (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL,
    student_id          INT UNSIGNED    NOT NULL,
    amount              DECIMAL(10,2)   NOT NULL,
    status              ENUM('pending', 'successful', 'failed') NOT NULL DEFAULT 'pending',
    transaction_ref     VARCHAR(100)    NULL,
    payment_date        DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payment_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_payment_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_payments_status (status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 7. EXAM CENTERS
-- ------------------------------------------------------------------
CREATE TABLE exam_centers (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    center_name         VARCHAR(150)    NOT NULL,
    address             TEXT            NULL,
    city                VARCHAR(100)    NOT NULL,
    state               VARCHAR(100)    NOT NULL,
    available_computers INT UNSIGNED    NOT NULL DEFAULT 0,
    max_capacity        INT UNSIGNED    NOT NULL DEFAULT 0,
    is_active           TINYINT(1)      NOT NULL DEFAULT 1,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_centers_city (city),
    CONSTRAINT chk_center_counts CHECK (available_computers <= max_capacity)   -- Phase 3B
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 8. COMPUTERS  (physical PCs at a center)
-- ------------------------------------------------------------------
CREATE TABLE computers (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    center_id       INT UNSIGNED    NOT NULL,
    pc_label        VARCHAR(30)     NOT NULL,   -- e.g. "PC-12"
    status          ENUM('available', 'allocated', 'maintenance') NOT NULL DEFAULT 'available',
    created_at      TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_center_pc (center_id, pc_label),
    CONSTRAINT fk_computer_center FOREIGN KEY (center_id) REFERENCES exam_centers(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 9. EXAM SLOTS  (a date + time window + center, for one examination)
-- ------------------------------------------------------------------
CREATE TABLE exam_slots (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    examination_id      INT UNSIGNED    NOT NULL,
    center_id           INT UNSIGNED    NOT NULL,
    exam_date           DATE            NOT NULL,
    slot_start_time     TIME            NOT NULL,
    slot_end_time       TIME            NOT NULL,
    capacity            INT UNSIGNED    NOT NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_slot_examination FOREIGN KEY (examination_id) REFERENCES examinations(id) ON DELETE CASCADE,
    CONSTRAINT fk_slot_center FOREIGN KEY (center_id) REFERENCES exam_centers(id) ON DELETE CASCADE,
    INDEX idx_slots_date (exam_date),
    UNIQUE KEY uq_slot_exam_center_start (examination_id, center_id, exam_date, slot_start_time),   -- Phase 3B
    CONSTRAINT chk_slot_times    CHECK (slot_start_time < slot_end_time),
    CONSTRAINT chk_slot_capacity CHECK (capacity > 0)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 10. CANDIDATE ALLOCATIONS  (registration -> center + slot)
-- ------------------------------------------------------------------
CREATE TABLE candidate_allocations (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL UNIQUE,
    exam_center_id      INT UNSIGNED    NOT NULL,
    exam_slot_id        INT UNSIGNED    NOT NULL,
    allocated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_alloc_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_alloc_center FOREIGN KEY (exam_center_id) REFERENCES exam_centers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_alloc_slot FOREIGN KEY (exam_slot_id) REFERENCES exam_slots(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 11. HALL TICKETS
-- ------------------------------------------------------------------
CREATE TABLE hall_tickets (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL UNIQUE,
    hall_ticket_number  VARCHAR(30)     NOT NULL UNIQUE,   -- e.g. HT20260001
    qr_code_data        TEXT            NULL,
    issued_at           TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_hallticket_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 12. QUESTIONS
-- ------------------------------------------------------------------
CREATE TABLE questions (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    examination_id      INT UNSIGNED    NOT NULL,
    question_text       TEXT            NOT NULL,
    question_type       ENUM('MCQ', 'MSQ', 'NAT') NOT NULL,
    marks               DECIMAL(6,2)    NOT NULL DEFAULT 1.00,
    negative_marks      DECIMAL(6,2)    NOT NULL DEFAULT 0.00,
    created_by          INT UNSIGNED    NULL,   -- teacher/examiner (users.id)
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_question_examination FOREIGN KEY (examination_id) REFERENCES examinations(id) ON DELETE CASCADE,
    CONSTRAINT fk_question_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_questions_examination (examination_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 13. QUESTION OPTIONS  (used for MCQ and MSQ; not used for NAT)
-- ------------------------------------------------------------------
CREATE TABLE question_options (
    id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    question_id     INT UNSIGNED    NOT NULL,
    option_text     TEXT            NOT NULL,
    is_correct      TINYINT(1)      NOT NULL DEFAULT 0,
    option_order    TINYINT UNSIGNED NOT NULL DEFAULT 0,
    CONSTRAINT fk_option_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    INDEX idx_options_question (question_id)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 14. EXAM ATTEMPTS  (one candidate's attempt at their allocated exam)
-- ------------------------------------------------------------------
CREATE TABLE exam_attempts (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL UNIQUE,
    computer_id         INT UNSIGNED    NULL,
    started_at          DATETIME        NULL,
    submitted_at        DATETIME        NULL,
    status              ENUM('not_started', 'in_progress', 'submitted') NOT NULL DEFAULT 'not_started',
    result_status       ENUM('not_evaluated', 'evaluated', 'published') NOT NULL DEFAULT 'not_evaluated',
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_attempt_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_computer FOREIGN KEY (computer_id) REFERENCES computers(id) ON DELETE SET NULL,
    INDEX idx_attempts_status (status),
    INDEX idx_attempts_result_status (result_status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 15. STUDENT ANSWERS
-- ------------------------------------------------------------------
CREATE TABLE student_answers (
    id                      INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attempt_id              INT UNSIGNED    NOT NULL,
    question_id             INT UNSIGNED    NOT NULL,
    selected_option_ids     JSON            NULL,   -- e.g. [3, 5] for MCQ/MSQ
    nat_answer              VARCHAR(50)     NULL,   -- for NAT questions
    answer_status           ENUM('not_visited', 'not_answered', 'answered', 'marked_for_review', 'answered_marked_for_review')
                            NOT NULL DEFAULT 'not_visited',
    updated_at              TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_attempt_question (attempt_id, question_id),
    CONSTRAINT fk_answer_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_answer_question FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 16. INVIGILATOR VERIFICATIONS
-- ------------------------------------------------------------------
CREATE TABLE invigilator_verifications (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL UNIQUE,
    invigilator_id      INT UNSIGNED    NULL,
    attendance_status   ENUM('not_arrived', 'present', 'verified', 'absent', 'exam_started', 'exam_submitted')
                        NOT NULL DEFAULT 'not_arrived',
    id_proof_checked    TINYINT(1)      NOT NULL DEFAULT 0,
    notes               TEXT            NULL,
    verified_at         DATETIME        NULL,
    created_at          TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_verification_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_verification_invigilator FOREIGN KEY (invigilator_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_verification_status (attendance_status)
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 17. COMPUTER ALLOCATIONS  (invigilator assigns a specific PC)
--     A computer can never be double-booked for the same slot.
-- ------------------------------------------------------------------
CREATE TABLE computer_allocations (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    registration_id     INT UNSIGNED    NOT NULL UNIQUE,
    computer_id         INT UNSIGNED    NOT NULL,
    exam_slot_id        INT UNSIGNED    NOT NULL,
    allocated_by        INT UNSIGNED    NULL,   -- invigilator (users.id)
    allocated_at        TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_computer_slot (computer_id, exam_slot_id),
    CONSTRAINT fk_compalloc_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE CASCADE,
    CONSTRAINT fk_compalloc_computer FOREIGN KEY (computer_id) REFERENCES computers(id) ON DELETE RESTRICT,
    CONSTRAINT fk_compalloc_slot FOREIGN KEY (exam_slot_id) REFERENCES exam_slots(id) ON DELETE RESTRICT,
    CONSTRAINT fk_compalloc_invigilator FOREIGN KEY (allocated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 18. RESULTS  (kept separate from exam_attempts so publication is a
--     single, explicit, auditable action by the administrator)
-- ------------------------------------------------------------------
CREATE TABLE results (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    attempt_id          INT UNSIGNED    NOT NULL UNIQUE,
    total_marks         DECIMAL(8,2)    NOT NULL DEFAULT 0,
    obtained_marks      DECIMAL(8,2)    NOT NULL DEFAULT 0,
    correct_count       INT UNSIGNED    NOT NULL DEFAULT 0,
    wrong_count         INT UNSIGNED    NOT NULL DEFAULT 0,
    percentage          DECIMAL(5,2)    NOT NULL DEFAULT 0,
    evaluated_by        INT UNSIGNED    NULL,
    evaluated_at        DATETIME        NULL,
    published_at        DATETIME        NULL,
    CONSTRAINT fk_result_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_result_evaluator FOREIGN KEY (evaluated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ------------------------------------------------------------------
-- 19. NOTIFICATIONS  (log of emails sent to students)
-- ------------------------------------------------------------------
CREATE TABLE notifications (
    id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    student_id          INT UNSIGNED    NULL,
    registration_id     INT UNSIGNED    NULL,
    type                VARCHAR(50)     NOT NULL,   -- e.g. 'otp', 'hall_ticket', 'schedule'
    subject             VARCHAR(255)    NOT NULL,
    message             TEXT            NULL,
    status              ENUM('sent', 'failed') NOT NULL DEFAULT 'sent',
    sent_at             TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notification_student FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE SET NULL,
    CONSTRAINT fk_notification_registration FOREIGN KEY (registration_id) REFERENCES registrations(id) ON DELETE SET NULL,
    INDEX idx_notifications_type (type)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;
