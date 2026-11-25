-- Run once on an existing .data/forms.db, after backing it up and stopping the services.
-- A database created by the current build already has these columns, so this will
-- report "duplicate column name" on it. That is harmless: nothing else in the file runs.
--
--   sqlite3 .data/forms.db < scripts/migrations/001_reviewer_claims.sql

ALTER TABLE forms ADD COLUMN claimed_by TEXT;
ALTER TABLE forms ADD COLUMN claimed_at TEXT;
ALTER TABLE forms ADD COLUMN approved_by TEXT;
ALTER TABLE forms ADD COLUMN approved_at TEXT;
