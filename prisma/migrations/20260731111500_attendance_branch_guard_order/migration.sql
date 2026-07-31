BEGIN;

DROP TRIGGER IF EXISTS "employee_sessions_attendance_branch_insert_guard"
ON "employee_sessions";
DROP TRIGGER IF EXISTS "employee_sessions_attendance_branch_update_guard"
ON "employee_sessions";

-- PostgreSQL runs triggers of the same kind alphabetically. The zz_ prefix
-- preserves the established employee_sessions_scope_guard error ordering.
CREATE TRIGGER "zz_employee_sessions_attendance_branch_insert_guard"
BEFORE INSERT ON "employee_sessions"
FOR EACH ROW
EXECUTE FUNCTION "validate_employee_session_attendance_branch_scope"();

CREATE TRIGGER "zz_employee_sessions_attendance_branch_update_guard"
BEFORE UPDATE OF "attendance_branch_id"
ON "employee_sessions"
FOR EACH ROW
EXECUTE FUNCTION "validate_employee_session_attendance_branch_scope"();

COMMIT;