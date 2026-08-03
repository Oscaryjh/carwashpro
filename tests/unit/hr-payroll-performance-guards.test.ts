import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const devSupervisorSource = readFileSync(
  new URL("../../scripts/dev-supervisor.mjs", import.meta.url),
  "utf8",
);
const peoplePageSource = readFileSync(
  new URL("../../src/app/(business)/team/page.tsx", import.meta.url),
  "utf8",
);
const attendancePageSource = readFileSync(
  new URL(
    "../../src/app/(business)/team/attendance/page.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("local development skips optional workers when their configuration is absent", () => {
  assert.match(
    devSupervisorSource,
    /if \(process\.env\.AUTH_INFO_PATH\?\.trim\(\)\)/,
  );
  assert.match(
    devSupervisorSource,
    /whatsappSendMode === "mock" \|\| whatsappSendMode === "live"/,
  );
  assert.match(
    devSupervisorSource,
    /Notification queue worker disabled for local development/,
  );
  assert.match(
    devSupervisorSource,
    /WhatsApp Connector disabled for local development/,
  );
});

test("optional workers do not enter a rapid startup restart loop", () => {
  assert.match(
    devSupervisorSource,
    /minimumHealthyWorkerUptimeMs = 10_000/,
  );
  assert.match(
    devSupervisorSource,
    /Automatic restart disabled until the dev server is restarted/g,
  );
});

test("People loads section-only data only when that section needs it", () => {
  assert.match(peoplePageSource, /staffDataRequired \? prisma\.user\.findMany/);
  assert.match(peoplePageSource, /serviceDataRequired \? prisma\.service\.findMany/);
  assert.match(peoplePageSource, /activityDataRequired \? prisma\.auditLog\.findMany/);
  assert.match(peoplePageSource, /attendanceDataRequired \? prisma\.employeeAttendance\.findMany/);
});

test("Attendance overlaps supporting, summary, and table queries", () => {
  assert.match(
    attendancePageSource,
    /const supportingDataPromise = prisma\.employeeBusinessMembership\.findMany/,
  );
  assert.match(
    attendancePageSource,
    /const \[totalRecords, monthlyMembers\] = await Promise\.all/,
  );
  assert.match(attendancePageSource, /monthlySessionsPromise/);
});
