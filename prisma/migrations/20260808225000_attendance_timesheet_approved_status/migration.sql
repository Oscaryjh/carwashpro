-- APPROVED is introduced in its own committed migration so PostgreSQL can use
-- the enum value safely in the following Attendance P2 migration.
ALTER TYPE "AttendanceTimesheetStatus" ADD VALUE IF NOT EXISTS 'APPROVED' BEFORE 'LOCKED';
