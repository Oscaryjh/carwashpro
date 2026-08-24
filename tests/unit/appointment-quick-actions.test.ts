import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const appointmentCalendarPath = path.join(
  process.cwd(),
  "src/components/appointment-calendar.tsx",
);

test("appointment delays keep the detail card open when the update is rejected", async () => {
  const source = await readFile(appointmentCalendarPath, "utf8");

  assert.match(source, /const result = await updateAppointmentAction\(formData\)/);
  assert.match(source, /isFailedAppointmentMutation\(result\)/);
  assert.match(source, /setAppointmentUpdateError\(result\.error\)/);
  assert.match(source, />Appointment not changed</);
});

test("no-show and cancellation use an in-app confirmation card", async () => {
  const source = await readFile(appointmentCalendarPath, "utf8");

  assert.doesNotMatch(source, /window\.confirm/);
  assert.match(source, /setPendingAppointmentStatus\("NO_SHOW"\)/);
  assert.match(source, /setPendingAppointmentStatus\("CANCELLED"\)/);
  assert.match(source, /"Mark as no show\?"/);
  assert.match(source, /"Cancel this appointment\?"/);
  assert.match(source, /Keep appointment/);
});
