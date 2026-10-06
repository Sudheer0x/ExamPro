-- ==================================================================
-- Migration 001 — Phase 2 (authentication + RBAC)
-- Safe to run on the existing exampro_db: it only widens one column and
-- adds one NEW table. No DROP, no DELETE, no data is touched.
--
-- Run:  mysql -u root -p exampro_db < database/migrations/001_phase2_auth.sql
-- Re-running it is harmless (MODIFY re-applies the same type; the table
-- uses IF NOT EXISTS).
-- ==================================================================

SET NAMES utf8mb4;

-- 1. Hashed OTPs are longer than 10 characters (HMAC-SHA256 hex = 64).
--    255 leaves room to change the hashing method later.
ALTER TABLE email_otps
    MODIFY COLUMN otp_code VARCHAR(255) NOT NULL;

-- 2. Revocable refresh tokens. A token belongs to EITHER a staff user OR a
--    student, so there are two nullable foreign keys and a CHECK that
--    exactly one of them is set.
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id     INT UNSIGNED    NULL,
    student_id  INT UNSIGNED    NULL,
    token_hash  CHAR(64)        NOT NULL UNIQUE,   -- SHA-256 of the cookie value
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
