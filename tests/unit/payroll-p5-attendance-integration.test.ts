import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildAttendancePayrollComponents,
  buildPayrollAttendanceInput,
  CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY,
  OVERTIME_APPROVAL_SOURCE_NOT_READY,
  proposeAttendancePayrollCorrection,
} from "../../src/lib/payroll/attendance-integration";

const periodStart = new Date("2026-08-01T00:00:00.000Z");

test("P5 consumes frozen final outcomes and never turns no-punch states into unpaid leave", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-1",
    payBasis: "DAILY",
    days: [
      day("present", "PRESENT", 480, "WORKDAY"),
      day("paid", "APPROVED_PAID_LEAVE", 0, "WORKDAY", 0.5),
      day("unpaid", "APPROVED_UNPAID_LEAVE", 0, "WORKDAY", 1),
      day("off", "NOT_SCHEDULED", 0, "NOT_SCHEDULED"),
    ],
  });
  assert.equal(attendance.regularDayHundredths, 100);
  assert.equal(attendance.paidLeaveDayHundredths, 50);
  assert.equal(attendance.unpaidLeaveDayHundredths, 100);
  assert.equal(attendance.unauthorizedAbsenceDayHundredths, 0);
  assert.deepEqual(attendance.policyBlockers, []);

  const lines = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000001",
    timesheetRevision: 5,
    periodStart,
    payBasis: "DAILY",
    baseRateCents: 10_000,
    attendance,
  });
  assert.deepEqual(
    lines.map((line) => [line.code, line.amountCents, line.sourceType]),
    [
      ["REGULAR_DAILY_PAY", 10_000, "ATTENDANCE"],
      ["PAID_LEAVE_PAY", 5_000, "ATTENDANCE"],
    ],
  );
  assert.ok(lines.every((line) => line.sourceRevision === 5));
});

test("P5 hourly pay uses approved integer minutes with deterministic rounding", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-2",
    payBasis: "HOURLY",
    days: [day("hourly", "PRESENT_LATE_UNAUTHORIZED", 91, "WORKDAY")],
  });
  const first = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000002",
    timesheetRevision: 2,
    periodStart,
    payBasis: "HOURLY",
    baseRateCents: 1_500,
    attendance,
  });
  const second = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000002",
    timesheetRevision: 2,
    periodStart,
    payBasis: "HOURLY",
    baseRateCents: 1_500,
    attendance,
  });
  assert.deepEqual(first, second);
  assert.equal(first[0]?.amountCents, 2_275);
  assert.equal(attendance.approvedOvertimeMinutes, 0);
});

test("P5 blocks potential overtime until Attendance freezes an approved overtime source", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-overtime",
    payBasis: "HOURLY",
    days: [
      {
        ...day("potential-overtime", "PRESENT", 540, "WORKDAY"),
        expectedStartAt: new Date("2026-08-03T01:00:00.000Z"),
        expectedEndAt: new Date("2026-08-03T09:00:00.000Z"),
        actualClockInAt: new Date("2026-08-03T01:00:00.000Z"),
        actualClockOutAt: new Date("2026-08-03T10:00:00.000Z"),
        timezoneSnapshot: "Asia/Kuala_Lumpur",
        crossMidnightSnapshot: false,
      },
    ],
  });

  assert.ok(attendance.policyBlockers.includes(OVERTIME_APPROVAL_SOURCE_NOT_READY));
  assert.equal(attendance.approvedOvertimeMinutes, 0);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000020",
      timesheetRevision: 1,
      periodStart,
      payBasis: "HOURLY",
      baseRateCents: 1_500,
      attendance,
    }),
    [],
  );
});

test("P5 never assigns a cross-midnight shift to one statutory day", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-overnight",
    payBasis: "HOURLY",
    publicHolidayPayPolicyReady: true,
    days: [
      {
        ...day("overnight", "PUBLIC_HOLIDAY", 480, "PUBLIC_HOLIDAY"),
        expectedStartAt: new Date("2026-08-31T14:00:00.000Z"),
        expectedEndAt: new Date("2026-08-31T22:00:00.000Z"),
        actualClockInAt: new Date("2026-08-31T14:00:00.000Z"),
        actualClockOutAt: new Date("2026-08-31T22:00:00.000Z"),
        timezoneSnapshot: "Asia/Kuala_Lumpur",
        crossMidnightSnapshot: true,
      },
    ],
  });

  assert.ok(
    attendance.policyBlockers.includes(
      CROSS_MIDNIGHT_STATUTORY_SEGMENTATION_NOT_READY,
    ),
  );
  assert.equal(attendance.regularMinutes, 0);
  assert.equal(attendance.restDayWorkedMinutes, 0);
  assert.equal(attendance.publicHolidayWorkedMinutes, 0);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000021",
      timesheetRevision: 1,
      periodStart,
      payBasis: "HOURLY",
      baseRateCents: 1_500,
      attendance,
    }),
    [],
  );
});

test("P5 keeps Monthly base salary separate and fails closed for unsupported money policies", () => {
  const fullMonth = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    days: [day("normal", "PRESENT", 600, "WORKDAY")],
  });
  assert.deepEqual(fullMonth.policyBlockers, []);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000003",
      timesheetRevision: 1,
      periodStart,
      payBasis: "MONTHLY",
      baseRateCents: 350_000,
      attendance: fullMonth,
    }),
    [],
  );
  assert.equal(fullMonth.approvedOvertimeMinutes, 0);

  const unsupported = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    days: [
      day("unpaid", "APPROVED_UNPAID_LEAVE", 0, "WORKDAY", 1),
      day("absence", "UNAUTHORIZED_ABSENCE", 0, "WORKDAY"),
      day("rest", "REST_DAY", 240, "REST_DAY"),
      day("ph", "PUBLIC_HOLIDAY", 480, "PUBLIC_HOLIDAY"),
    ],
  });
  assert.equal(unsupported.unpaidLeaveDayHundredths, 100);
  assert.equal(unsupported.unauthorizedAbsenceDayHundredths, 100);
  assert.deepEqual(unsupported.policyBlockers, [
    "PAYROLL_ABSENCE_RATE_POLICY_NOT_READY",
    "PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY",
    "REST_DAY_RATE_POLICY_NOT_READY",
  ]);
  assert.deepEqual(
    buildAttendancePayrollComponents({
      snapshotId: "10000000-0000-4000-8000-000000000003",
      timesheetRevision: 1,
      periodStart,
      payBasis: "MONTHLY",
      baseRateCents: 350_000,
      attendance: unsupported,
    }),
    [],
  );

  const policyReady = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    publicHolidayPayPolicyReady: true,
    days: [day("ph-ready", "PUBLIC_HOLIDAY", 480, "PUBLIC_HOLIDAY")],
  });
  assert.equal(policyReady.publicHolidayWorkedMinutes, 480);
  assert.doesNotMatch(
    policyReady.policyBlockers.join(","),
    /PUBLIC_HOLIDAY_RATE_POLICY_NOT_READY/,
  );

  const absencePolicyReady = buildPayrollAttendanceInput({
    membershipId: "member-3",
    payBasis: "MONTHLY",
    monthlyAbsencePolicyReady: true,
    days: [day("absence-ready", "UNAUTHORIZED_ABSENCE", 0, "WORKDAY")],
  });
  assert.deepEqual(absencePolicyReady.policyBlockers, []);
  const absenceLines = buildAttendancePayrollComponents({
    snapshotId: "10000000-0000-4000-8000-000000000003",
    timesheetRevision: 1,
    periodStart,
    payBasis: "MONTHLY",
    baseRateCents: 260_000,
    workingDaysPerMonth: 26,
    attendance: absencePolicyReady,
  });
  assert.equal(absenceLines.length, 1);
  assert.equal(absenceLines[0]?.type, "DEDUCTION");
  assert.equal(absenceLines[0]?.code, "UNPAID_ABSENCE_DEDUCTION");
  assert.equal(absenceLines[0]?.amountCents, 10_000);
});

test("P5 correction bridge proposes a P4C-governed future delta without rewriting history", () => {
  const oldAttendance = buildPayrollAttendanceInput({
    membershipId: "member-4",
    payBasis: "HOURLY",
    days: [day("old", "PRESENT", 60, "WORKDAY")],
  });
  const newAttendance = buildPayrollAttendanceInput({
    membershipId: "member-4",
    payBasis: "HOURLY",
    days: [day("new", "PRESENT", 120, "WORKDAY")],
  });
  assert.deepEqual(
    proposeAttendancePayrollCorrection({
      payBasis: "HOURLY",
      baseRateCents: 1_500,
      periodStart,
      oldRevision: 3,
      newRevision: 4,
      oldAttendance,
      newAttendance,
    }),
    {
      status: "PROPOSED",
      oldAmountCents: 1_500,
      newAmountCents: 3_000,
      deltaType: "EARNING",
      deltaAmountCents: 1_500,
    },
  );
});

test("Phase 2D freezes auditable Leave facts and preserves partial work beside half-day leave", () => {
  const attendance = buildPayrollAttendanceInput({
    membershipId: "member-leave",
    payBasis: "DAILY",
    days: [day("half-paid", "APPROVED_PAID_LEAVE", 240, "WORKDAY", 0.5)],
  });
  assert.equal(attendance.paidLeaveDayHundredths, 50);
  assert.equal(attendance.regularDayHundredths, 50);
  assert.equal(attendance.regularMinutes, 240);
  assert.equal(attendance.leaveFacts.length, 1);
  assert.deepEqual(attendance.leaveCategoryBreakdown, [
    {
      category: "COMPANY_PAID_LEAVE",
      payTreatment: "PAID",
      dayHundredths: 50,
      requestCount: 1,
    },
  ]);
  assert.deepEqual(attendance.policyBlockers, []);
});

test("Phase 2D fails closed for incomplete, inactive statutory and maternity evidence", () => {
  const incomplete = {
    ...day("incomplete", "APPROVED_PAID_LEAVE", 0, "WORKDAY", 1),
    leaveRequestDigestSnapshot: null,
  };
  const inactive = {
    ...day("inactive", "APPROVED_PAID_LEAVE", 0, "WORKDAY", 1),
    leaveStatutoryCategorySnapshot: "SICK_LEAVE",
    leaveStatutoryRuleSetVersionSnapshot: "MY-SABAH-2026-v1",
    leaveStatutoryRuleSetStatusSnapshot: "READY_FOR_HUMAN_SIGN_OFF",
  };
  const maternity = {
    ...day("maternity", "APPROVED_PAID_LEAVE", 0, "WORKDAY", 1),
    leaveStatutoryCategorySnapshot: "MATERNITY_LEAVE",
    leaveStatutoryRuleSetVersionSnapshot: "MY-SABAH-2026-v1",
    leaveStatutoryRuleSetStatusSnapshot: "ACTIVE",
    leaveStatutoryEligibilitySnapshot: { allowanceEligibility: "READY_FOR_REVIEW" },
  };
  assert.ok(
    buildPayrollAttendanceInput({ membershipId: "m", payBasis: "DAILY", days: [incomplete] })
      .policyBlockers.includes("APPROVED_LEAVE_EVIDENCE_INCOMPLETE"),
  );
  assert.ok(
    buildPayrollAttendanceInput({ membershipId: "m", payBasis: "DAILY", days: [inactive] })
      .policyBlockers.includes("LEAVE_STATUTORY_RULE_NOT_ACTIVE"),
  );
  assert.ok(
    buildPayrollAttendanceInput({ membershipId: "m", payBasis: "DAILY", days: [maternity] })
      .policyBlockers.includes("MATERNITY_ALLOWANCE_REVIEW_REQUIRED"),
  );
});

test("P5 service and migration enforce the locked snapshot boundary", () => {
  const service = readFileSync("src/lib/payroll/service.ts", "utf8");
  const bridge = readFileSync("src/lib/payroll/timesheet-bridge.ts", "utf8");
  const readiness = readFileSync("src/lib/payroll/readiness.ts", "utf8");
  const migration = readFileSync(
    "prisma/migrations/20260808234000_payroll_p5_attendance_integration/migration.sql",
    "utf8",
  );
  assert.match(service, /timesheet\.p2Days/);
  assert.match(service, /payrollAttendanceInputSnapshot\.upsert/);
  assert.doesNotMatch(service, /employeeAttendance\.findMany|leaveRequestDay\.findMany|payrollHoliday\.findMany/);
  assert.doesNotMatch(service, /calculatePayroll\(/);
  assert.match(bridge, /attendanceTimesheetP2DaySnapshot\.findMany/);
  assert.match(readiness, /STALE_ATTENDANCE_SOURCE/);
  assert.match(readiness, /ATTENDANCE_PAY_POLICY_NOT_READY/);
  assert.match(migration, /Payroll Attendance snapshot provenance mismatch/);
  assert.match(migration, /Attendance Payroll component must reference its exact employee snapshot/);
  assert.doesNotMatch(migration, /DROP\s+(TABLE|COLUMN)/i);
  assert.doesNotMatch(migration, /UPDATE\s+"payroll_(runs|entries)"/i);
});

test("P5 keeps Attendance and Payroll permission surfaces separated", () => {
  const payrollActions = readFileSync(
    "src/app/(business)/team/payroll/actions.ts",
    "utf8",
  );
  const attendanceActions = [
    "src/app/(business)/team/attendance/p2/actions.ts",
    "src/app/(business)/team/attendance/resolutions/actions.ts",
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(
    payrollActions,
    /generatePayrollRunAction[\s\S]*?requireWholeBusinessPayroll\("CREATE_PAYROLL_RUN"\)/,
  );
  assert.match(payrollActions, /requireWholeBusinessPayroll\("EDIT_PAYROLL_ENTRY"\)/);
  assert.match(attendanceActions, /MODIFY_ATTENDANCE_EMPLOYEES/);
  assert.doesNotMatch(
    attendanceActions,
    /payrollEntry|payrollRun|employeeCompensationVersion|baseSalary/,
  );
});

function day(
  id: string,
  outcome: Parameters<typeof buildPayrollAttendanceInput>[0]["days"][number]["outcome"],
  totalWorkedMinutes: number,
  expectedDayKindSnapshot: Parameters<typeof buildPayrollAttendanceInput>[0]["days"][number]["expectedDayKindSnapshot"],
  leaveDayFractionSnapshot: number | null = null,
) {
  const isLeave = outcome === "APPROVED_PAID_LEAVE" || outcome === "APPROVED_UNPAID_LEAVE";
  const requestId = `10000000-0000-4000-8000-${String(id.length).padStart(12, "0")}`;
  return {
    id,
    workDate: new Date(`2026-08-${String(1 + id.length).padStart(2, "0")}T00:00:00.000Z`),
    outcome,
    expectedDayKindSnapshot,
    leaveDayFractionSnapshot,
    totalWorkedMinutes,
    sourceDigest: id.padEnd(64, "0").slice(0, 64),
    leaveRequestIdSnapshot: isLeave ? requestId : null,
    leaveRequestRevisionSnapshot: isLeave ? 1 : null,
    leaveRequestDigestSnapshot: isLeave ? id.padEnd(64, "a").slice(0, 64) : null,
    leavePolicyIdSnapshot: isLeave ? "20000000-0000-4000-8000-000000000001" : null,
    leavePolicyVersionIdSnapshot: isLeave ? "30000000-0000-4000-8000-000000000001" : null,
    leavePolicyNameSnapshot: isLeave ? "Company Leave" : null,
    leavePayTreatmentSnapshot:
      outcome === "APPROVED_PAID_LEAVE"
        ? ("PAID" as const)
        : outcome === "APPROVED_UNPAID_LEAVE"
          ? ("UNPAID" as const)
          : null,
    leaveUnitSnapshot:
      isLeave ? (leaveDayFractionSnapshot === 0.5 ? ("HALF_DAY_AM" as const) : ("FULL_DAY" as const)) : null,
    leaveLegalStatusSnapshot: isLeave ? "COMPANY_POLICY_ONLY" : null,
    leaveJurisdictionCodeSnapshot: null,
    leaveStatutoryRuleSetVersionSnapshot: null,
    leaveStatutoryRuleSetStatusSnapshot: null,
    leaveStatutoryCategorySnapshot: null,
    leaveStatutoryEligibilitySnapshot: null,
    leaveStatutoryPayTreatmentSnapshot: null,
    leaveComplianceStatusSnapshot: isLeave ? "NOT_APPLICABLE" : null,
  };
}
