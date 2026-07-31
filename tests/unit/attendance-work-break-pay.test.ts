import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { branchAttendanceSettingInputSchema } from "../../src/lib/attendance/branch-setting";
import { attendancePunchInputSchema } from "../../src/lib/attendance/punch-input";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const BRANCH_ID = "22222222-2222-4222-8222-222222222222";

test("work and break policy defaults preserve existing manual punch behaviour", () => {
  const setting = branchAttendanceSettingInputSchema.parse({
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    latitude: 1.5535,
    longitude: 110.3593,
  });

  assert.equal(setting.breakPolicy, "MANUAL_PUNCH");
  assert.equal(setting.targetBreakMinutes, 60);
  assert.equal(setting.normalWorkMinutesPerDay, 480);
  assert.equal(setting.shiftSpanMinutes, 540);
});

test("service branches can use flexible break confirmation", () => {
  const setting = branchAttendanceSettingInputSchema.parse({
    businessId: BUSINESS_ID,
    branchId: BRANCH_ID,
    latitude: 1.5535,
    longitude: 110.3593,
    breakPolicy: "FLEXIBLE_CONFIRMATION",
    targetBreakMinutes: 60,
    normalWorkMinutesPerDay: 480,
    shiftSpanMinutes: 540,
  });

  assert.equal(setting.breakPolicy, "FLEXIBLE_CONFIRMATION");
  assert.equal(
    branchAttendanceSettingInputSchema.safeParse({
      ...setting,
      targetBreakMinutes: 481,
    }).success,
    false,
  );
});

test("clock out evidence accepts bounded break confirmation", () => {
  const parsed = attendancePunchInputSchema.parse({
    branchId: BRANCH_ID,
    deviceIdentifier: "verified-device-123",
    idempotencyKey: "clock-out:request-123",
    confirmedBreakMinutes: 45,
    breakExceptionReason: "Busy appointment schedule",
  });

  assert.equal(parsed.confirmedBreakMinutes, 45);
  assert.equal(parsed.breakExceptionReason, "Busy appointment schedule");
  assert.equal(
    attendancePunchInputSchema.safeParse({
      ...parsed,
      confirmedBreakMinutes: 1441,
    }).success,
    false,
  );
});

test("work, break and pay migration is additive and transactional", () => {
  const sql = readFileSync(
    resolve(
      process.cwd(),
      "prisma",
      "migrations",
      "20260731130000_attendance_work_break_pay_foundation",
      "migration.sql",
    ),
    "utf8",
  ).replaceAll("\r\n", "\n");

  assert.match(sql, /^\s*--[\s\S]*?BEGIN;\s*/i);
  assert.match(sql, /\s*COMMIT;\s*$/i);
  assert.doesNotMatch(
    sql,
    /\b(?:DROP\s+(?:TABLE|SCHEMA|DATABASE|COLUMN)|TRUNCATE|DELETE\s+FROM)\b/i,
  );
  assert.match(sql, /DEFAULT 'MANUAL_PUNCH'/);
  assert.match(sql, /DEFAULT 60/);
  assert.match(sql, /DEFAULT 480/);
  assert.match(sql, /DEFAULT 540/);
  assert.match(sql, /CHECK \("base_salary" IS NULL OR "base_salary" >= 0\)/);
});

