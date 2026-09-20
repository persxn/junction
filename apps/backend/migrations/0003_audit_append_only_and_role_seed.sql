-- Custom migration (ruling F6: triggers and seed rows are written by hand, never
-- inferred by drizzle-kit, and `drizzle-kit push` is never used).
--
-- 1. audit_log is append-only (§6.2, ruling R35). The hash chain makes tampering
--    *detectable*; these two triggers make it impossible from inside the app, so
--    a bug in a repository cannot quietly rewrite history either.
CREATE TRIGGER audit_log_no_update
BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER audit_log_no_delete
BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log is append-only');
END;
--> statement-breakpoint
-- 2. The two roles §10 fixes. Their ids are literal rather than generated so the
--    same database opened by any build agrees on which row is which; they are
--    valid UUIDv7 values (§6.1) with a fixed random part.
INSERT INTO roles (id, key, name) VALUES
  ('01926b00-0000-7000-8000-000000000001', 'ADMINISTRATOR', 'Administrator'),
  ('01926b00-0000-7000-8000-000000000002', 'PROFESSOR', 'Professor')
ON CONFLICT (key) DO NOTHING;
