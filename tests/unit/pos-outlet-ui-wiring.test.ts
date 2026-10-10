import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("appointment new-service choices are scoped without replacing historical edit choices", () => {
  const page = readFileSync("src/app/(business)/appointments/page.tsx", "utf8");
  const calendar = readFileSync("src/components/appointment-calendar.tsx", "utf8");
  assert.match(page, /creationServiceIds=/);
  assert.match(page, /service\.branchId === outlet\.internalBranchId/);
  assert.match(calendar, /creationServices = creationServiceIds/);
  assert.match(calendar, /getServicesForStaff\(creationServices, newAppointmentStaffId\)/);
  assert.match(calendar, /editAppointmentStaffMembers = filterStaffForServices\(\s*staffMembers,\s*editAppointmentServiceIds,\s*services,/);
});
