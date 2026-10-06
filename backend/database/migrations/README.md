# Database migrations

Every change to the database structure after Phase 1 is a numbered `.sql` file in this folder.

* Name: `NNN_short_description.sql` — lowercase letters, digits and underscores (`002_exam_slot_rules.sql`).
* Run them with `npm run migrate` (from `backend/`). `npm run migrate:status` shows what is pending.
* **Never edit a migration that has been applied** — the runner will refuse to continue. Add a new one.
* Never `DROP TABLE`, `DROP DATABASE` or delete data in a migration.
* MySQL cannot roll back `ALTER`/`CREATE TABLE`, so write migrations that are safe to run twice
  (`CREATE TABLE IF NOT EXISTS`, `MODIFY COLUMN`, check-before-add patterns).
* Also update `database/schema.sql` so a fresh install gets the same result. A fresh install is:
  `schema.sql` first, then `npm run migrate` (it detects the changes are already there and just records them).
* The runner records files in a table called `schema_migrations`, which it creates itself.
