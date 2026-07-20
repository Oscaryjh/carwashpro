import assert from "node:assert/strict";
import test from "node:test";
import {
  APPOINTMENT_REMINDER_LEAD_TIME_MS,
  canScheduleAppointmentReminder,
  getAppointmentReminderAt,
  getAppointmentReminderDedupeKey,
} from "../../src/lib/whatsapp/appointment-reminders";

test("appointment reminders are scheduled 24 hours before the appointment", () => {
  const now = new Date("2026-07-13T02:00:00.000Z");
  const scheduledAt = new Date(
    now.getTime() + APPOINTMENT_REMINDER_LEAD_TIME_MS * 2,
  );

  assert.equal(
    getAppointmentReminderAt(scheduledAt, now)?.toISOString(),
    new Date(scheduledAt.getTime() - APPOINTMENT_REMINDER_LEAD_TIME_MS).toISOString(),
  );
});

test("appointments within 24 hours are queued immediately", () => {
  const now = new Date("2026-07-13T02:00:00.000Z");
  const scheduledAt = new Date(now.getTime() + 60 * 60 * 1000);

  assert.equal(getAppointmentReminderAt(scheduledAt, now)?.toISOString(), now.toISOString());
});

test("appointment reminder lead time can be configured per business", () => {
  const now = new Date("2026-07-13T02:00:00.000Z");
  const scheduledAt = new Date(now.getTime() + 3 * 60 * 60 * 1000);

  assert.equal(
    getAppointmentReminderAt(scheduledAt, now, 2 * 60 * 60 * 1000)?.toISOString(),
    new Date(scheduledAt.getTime() - 2 * 60 * 60 * 1000).toISOString(),
  );
});

test("past appointments are not scheduled", () => {
  const now = new Date("2026-07-13T02:00:00.000Z");

  assert.equal(
    getAppointmentReminderAt(new Date(now.getTime() - 1), now),
    null,
  );
});

test("only scheduled and confirmed appointments can receive reminders", () => {
  assert.equal(canScheduleAppointmentReminder("SCHEDULED"), true);
  assert.equal(canScheduleAppointmentReminder("CONFIRMED"), true);
  assert.equal(canScheduleAppointmentReminder("ARRIVED"), false);
  assert.equal(canScheduleAppointmentReminder("CONVERTED_TO_JOB"), false);
  assert.equal(canScheduleAppointmentReminder("CANCELLED"), false);
  assert.equal(canScheduleAppointmentReminder("NO_SHOW"), false);
});

test("rescheduling changes the reminder dedupe key", () => {
  const appointmentId = "018f34c0-94af-7a7b-9d61-ea51489f7ef7";
  const firstTime = new Date("2026-07-14T02:00:00.000Z");
  const secondTime = new Date("2026-07-14T03:00:00.000Z");

  assert.notEqual(
    getAppointmentReminderDedupeKey(appointmentId, firstTime),
    getAppointmentReminderDedupeKey(appointmentId, secondTime),
  );
});
