import { Prisma, PrismaClient } from "@prisma/client";

import {
  assertCanonicalTestingContext,
  assertCanonicalTestingDatabase,
  CanonicalTestingGuardError,
  fixtureMarker,
  parseCanonicalPrepareMode,
  safeJson,
  stableFixtureId,
  type CanonicalPrepareMode,
} from "./lib/canonical-testing-guard";

type RepairStatus =
  | "WOULD CREATE"
  | "WOULD UPDATE"
  | "NO CHANGE"
  | "EXPECTED PRODUCT CONTRACT"
  | "BLOCKED";

type RepairItem = {
  key: string;
  status: RepairStatus;
  detail: string;
};

const BUSINESS_ID = stableFixtureId("business.primary");
const MAIN_BRANCH_ID = stableFixtureId("branch.main");
const SECOND_BRANCH_ID = stableFixtureId("branch.second");
const MAIN_SETTING_ID = stableFixtureId("attendance-setting.main");
const SECOND_SETTING_ID = stableFixtureId("attendance-setting.second");
const OWNER_ID = stableFixtureId("user.owner");
const MANAGER_USER_ID = stableFixtureId("user.manager");
const STAFF_USER_ID = stableFixtureId("user.staff");
const MANAGER_MEMBERSHIP_ID = stableFixtureId("membership.manager");
const STAFF_MEMBERSHIP_ID = stableFixtureId("membership.staff");
const PAYROLL_RUN_ID = stableFixtureId("payroll-run.primary");
const PAYROLL_ENTRY_ID = stableFixtureId("payroll-entry.staff");
const PAYSLIP_ID = stableFixtureId("payslip.staff");

function expectedPayrollPeriod(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  };
}

function attendanceSettingMatches(
  setting: {
    id: string;
    businessId: string;
    branchId: string;
    latitude: Prisma.Decimal;
    longitude: Prisma.Decimal;
    geofenceRadiusMeters: number;
    minimumAccuracyMeters: number;
    requireGeofence: boolean;
    allowOutsideGeofenceRequest: boolean;
    requirePhoto: boolean;
    breakPolicy: string;
    targetBreakMinutes: number;
    normalWorkMinutesPerDay: number;
    shiftSpanMinutes: number;
    timezone: string;
    isEnabled: boolean;
  },
  expectedId: string,
  branchId: string,
) {
  return (
    setting.id === expectedId &&
    setting.businessId === BUSINESS_ID &&
    setting.branchId === branchId &&
    setting.latitude.equals(new Prisma.Decimal("3.139000")) &&
    setting.longitude.equals(new Prisma.Decimal("101.686900")) &&
    setting.geofenceRadiusMeters === 100 &&
    setting.minimumAccuracyMeters === 80 &&
    setting.requireGeofence === false &&
    setting.allowOutsideGeofenceRequest === true &&
    setting.requirePhoto === false &&
    setting.breakPolicy === "MANUAL_PUNCH" &&
    setting.targetBreakMinutes === 60 &&
    setting.normalWorkMinutesPerDay === 480 &&
    setting.shiftSpanMinutes === 540 &&
    setting.timezone === "Asia/Singapore" &&
    setting.isEnabled === true
  );
}

export async function inspectCanonicalPhase2Repair(
  prisma: PrismaClient,
  now = new Date(),
) {
  const period = expectedPayrollPeriod(now);
  const [mainSetting, secondSetting, payrollRun, payrollEntry, payslip, owner, manager, staff] =
    await Promise.all([
      prisma.branchAttendanceSetting.findUnique({ where: { branchId: MAIN_BRANCH_ID } }),
      prisma.branchAttendanceSetting.findUnique({ where: { branchId: SECOND_BRANCH_ID } }),
      prisma.payrollRun.findUnique({ where: { id: PAYROLL_RUN_ID } }),
      prisma.payrollEntry.findUnique({ where: { id: PAYROLL_ENTRY_ID } }),
      prisma.payrollPayslipPublication.findUnique({ where: { id: PAYSLIP_ID } }),
      prisma.user.findUnique({
        where: { id: OWNER_ID },
        select: { id: true, role: true, employeeBusinessMembershipId: true },
      }),
      prisma.user.findUnique({
        where: { id: MANAGER_USER_ID },
        select: {
          id: true,
          name: true,
          employeeBusinessMembershipId: true,
          employeeAccount: {
            select: {
              id: true,
              name: true,
              memberships: { select: { businessId: true } },
            },
          },
        },
      }),
      prisma.user.findUnique({
        where: { id: STAFF_USER_ID },
        select: {
          id: true,
          name: true,
          employeeBusinessMembershipId: true,
          employeeAccount: {
            select: {
              id: true,
              name: true,
              memberships: { select: { businessId: true } },
            },
          },
        },
      }),
    ]);

  const plan: RepairItem[] = [];
  for (const [key, setting, expectedId, branchId] of [
    ["attendance-setting.main", mainSetting, MAIN_SETTING_ID, MAIN_BRANCH_ID],
    ["attendance-setting.second", secondSetting, SECOND_SETTING_ID, SECOND_BRANCH_ID],
  ] as const) {
    if (!setting) {
      plan.push({ key, status: "WOULD CREATE", detail: "Create canonical enabled Attendance configuration." });
    } else if (setting.id !== expectedId || setting.businessId !== BUSINESS_ID) {
      plan.push({ key, status: "BLOCKED", detail: "Existing branch setting is not fixture-owned." });
    } else {
      plan.push({
        key,
        status: attendanceSettingMatches(setting, expectedId, branchId) ? "NO CHANGE" : "WOULD UPDATE",
        detail: "Normalize canonical Attendance configuration without weakening runtime guards.",
      });
    }
  }

  const duplicatePayrollRun = payrollRun
    ? await prisma.payrollRun.findFirst({
        where: {
          businessId: BUSINESS_ID,
          periodStart: period.start,
          periodEnd: period.end,
          id: { not: PAYROLL_RUN_ID },
        },
        select: { id: true },
      })
    : null;
  const payrollOwned = Boolean(
    payrollRun &&
      payrollRun.businessId === BUSINESS_ID &&
      payrollEntry?.businessId === BUSINESS_ID &&
      payrollEntry.payrollRunId === PAYROLL_RUN_ID &&
      payrollEntry.notes === fixtureMarker("payroll-entry.staff") &&
      payslip?.businessId === BUSINESS_ID &&
      payslip.payrollRunId === PAYROLL_RUN_ID &&
      payslip.payrollEntryId === PAYROLL_ENTRY_ID &&
      payslip.membershipId === STAFF_MEMBERSHIP_ID &&
      payrollRun?.status === "FINALIZED" &&
      payrollRun.submittedAt !== null &&
      payrollRun.finalizedAt !== null,
  );
  if (!payrollOwned || duplicatePayrollRun || payrollRun?.periodStart.getTime() !== period.start.getTime()) {
    plan.push({
      key: "payroll-period-boundary",
      status: "BLOCKED",
      detail: "Payroll fixture ownership, start boundary, dependent relationship, or uniqueness check failed.",
    });
  } else {
    plan.push({
      key: "payroll-period-boundary",
      status: payrollRun.periodEnd.getTime() === period.end.getTime() ? "NO CHANGE" : "WOULD UPDATE",
      detail: "Atomically repair the exclusive period end through the existing guarded reopen token, restore the exact finalized metadata, and leave the immutable published payslip unchanged.",
    });
  }

  const managerIdentityReady = Boolean(
    manager?.name === "Canonical UAT Manager" &&
      manager.employeeBusinessMembershipId === MANAGER_MEMBERSHIP_ID &&
      manager.employeeAccount &&
      manager.employeeAccount.memberships.some((membership) => membership.businessId !== BUSINESS_ID),
  );
  const staffIdentityReady = Boolean(
    staff?.name === "Canonical UAT Staff" &&
      staff.employeeBusinessMembershipId === STAFF_MEMBERSHIP_ID &&
      staff.employeeAccount &&
      staff.employeeAccount.memberships.some((membership) => membership.businessId !== BUSINESS_ID),
  );
  plan.push({
    key: "people.owner",
    status:
      owner?.role === "BUSINESS_OWNER" && owner.employeeBusinessMembershipId === null
        ? "EXPECTED PRODUCT CONTRACT"
        : "BLOCKED",
    detail: "People directory intentionally lists role=STAFF; the owner remains a business identity, not an employee membership.",
  });
  plan.push({
    key: "people.manager",
    status: managerIdentityReady ? "NO CHANGE" : "BLOCKED",
    detail: "Canonical manager User and membership remain business-specific; the phone account is shared and must not be renamed.",
  });
  plan.push({
    key: "people.staff",
    status: staffIdentityReady ? "NO CHANGE" : "BLOCKED",
    detail: "Canonical staff User and membership remain business-specific; the phone account is shared and must not be renamed.",
  });

  return { period, plan };
}

function assertRepairSafe(plan: readonly RepairItem[]) {
  const blocked = plan.filter((item) => item.status === "BLOCKED");
  if (blocked.length) {
    throw new CanonicalTestingGuardError(
      `Phase 2 fixture repair blocked: ${blocked.map((item) => item.key).join(", ")}.`,
    );
  }
}

function attendanceSettingData(id: string, branchId: string) {
  return {
    id,
    businessId: BUSINESS_ID,
    branchId,
    latitude: new Prisma.Decimal("3.139000"),
    longitude: new Prisma.Decimal("101.686900"),
    geofenceRadiusMeters: 100,
    minimumAccuracyMeters: 80,
    requireGeofence: false,
    allowOutsideGeofenceRequest: true,
    requirePhoto: false,
    breakPolicy: "MANUAL_PUNCH" as const,
    targetBreakMinutes: 60,
    normalWorkMinutesPerDay: 480,
    shiftSpanMinutes: 540,
    timezone: "Asia/Singapore",
    isEnabled: true,
  };
}

async function applyCanonicalPhase2Repair(
  prisma: PrismaClient,
  period: ReturnType<typeof expectedPayrollPeriod>,
  plan: readonly RepairItem[],
) {
  const changes = new Set(
    plan
      .filter((item) => item.status === "WOULD CREATE" || item.status === "WOULD UPDATE")
      .map((item) => item.key),
  );
  if (!changes.size) return [];

  return prisma.$transaction(async (tx) => {
    const applied: string[] = [];
    for (const [key, id, branchId] of [
      ["attendance-setting.main", MAIN_SETTING_ID, MAIN_BRANCH_ID],
      ["attendance-setting.second", SECOND_SETTING_ID, SECOND_BRANCH_ID],
    ] as const) {
      if (!changes.has(key)) continue;
      const existing = await tx.branchAttendanceSetting.findUnique({ where: { branchId } });
      if (existing && (existing.id !== id || existing.businessId !== BUSINESS_ID)) {
        throw new CanonicalTestingGuardError("Attendance setting ownership changed after dry-run.");
      }
      const data = attendanceSettingData(id, branchId);
      await tx.branchAttendanceSetting.upsert({
        where: { branchId },
        create: data,
        update: {
          businessId: data.businessId,
          latitude: data.latitude,
          longitude: data.longitude,
          geofenceRadiusMeters: data.geofenceRadiusMeters,
          minimumAccuracyMeters: data.minimumAccuracyMeters,
          requireGeofence: data.requireGeofence,
          allowOutsideGeofenceRequest: data.allowOutsideGeofenceRequest,
          requirePhoto: data.requirePhoto,
          breakPolicy: data.breakPolicy,
          targetBreakMinutes: data.targetBreakMinutes,
          normalWorkMinutesPerDay: data.normalWorkMinutesPerDay,
          shiftSpanMinutes: data.shiftSpanMinutes,
          timezone: data.timezone,
          isEnabled: data.isEnabled,
        },
      });
      applied.push(key);
    }

    if (changes.has("payroll-period-boundary")) {
      const run = await tx.payrollRun.findUniqueOrThrow({ where: { id: PAYROLL_RUN_ID } });
      const entry = await tx.payrollEntry.findUnique({
        where: { id: PAYROLL_ENTRY_ID },
      });
      const payslip = await tx.payrollPayslipPublication.findUnique({ where: { id: PAYSLIP_ID } });
      const duplicate = await tx.payrollRun.findFirst({
        where: {
          businessId: BUSINESS_ID,
          periodStart: period.start,
          periodEnd: period.end,
          id: { not: PAYROLL_RUN_ID },
        },
        select: { id: true },
      });
      if (
        run.businessId !== BUSINESS_ID ||
        run.periodStart.getTime() !== period.start.getTime() ||
        entry?.businessId !== BUSINESS_ID ||
        entry.payrollRunId !== PAYROLL_RUN_ID ||
        entry.notes !== fixtureMarker("payroll-entry.staff") ||
        payslip?.businessId !== BUSINESS_ID ||
        payslip.payrollRunId !== PAYROLL_RUN_ID ||
        payslip.payrollEntryId !== PAYROLL_ENTRY_ID ||
        payslip.membershipId !== STAFF_MEMBERSHIP_ID ||
        run.status !== "FINALIZED" ||
        !run.submittedAt ||
        !run.finalizedAt ||
        duplicate
      ) {
        throw new CanonicalTestingGuardError("Payroll fixture ownership changed after dry-run.");
      }

      // The database trigger permits only this explicit, transaction-local reopen token.
      // The published payslip blocks the normal product reopen workflow, so this guarded
      // fixture maintenance path restores the exact workflow metadata before commit.
      await tx.$executeRaw`
        SELECT set_config('tetamu.payroll_reopen', ${PAYROLL_RUN_ID}, TRUE)
      `;
      await tx.payrollRun.update({
        where: { id: PAYROLL_RUN_ID },
        data: {
          status: "DRAFT",
          submittedAt: null,
          submittedById: null,
          finalizedAt: null,
          finalizedById: null,
        },
      });
      await tx.payrollRun.update({
        where: { id: PAYROLL_RUN_ID },
        data: { periodEnd: period.end },
      });
      await tx.payrollRun.update({
        where: { id: PAYROLL_RUN_ID },
        data: {
          status: "FINALIZED",
          submittedAt: run.submittedAt,
          submittedById: run.submittedById,
          finalizedAt: run.finalizedAt,
          finalizedById: run.finalizedById,
        },
      });
      applied.push("payroll-period-boundary");
    }
    return applied;
  }, { timeout: 60_000, maxWait: 10_000 });
}

export async function runCanonicalPhase2Repair(
  prisma: PrismaClient,
  mode: CanonicalPrepareMode,
) {
  const environment = assertCanonicalTestingContext(process.env);
  const database = await assertCanonicalTestingDatabase(prisma);
  const inspected = await inspectCanonicalPhase2Repair(prisma);
  assertRepairSafe(inspected.plan);
  if (mode === "DRY_RUN") {
    return {
      mode,
      applied: false,
      environment,
      database,
      plan: inspected.plan,
      externalSideEffects: "BLOCKED_BY_DESIGN",
    };
  }

  assertCanonicalTestingContext(process.env);
  await assertCanonicalTestingDatabase(prisma);
  const applied = await applyCanonicalPhase2Repair(
    prisma,
    inspected.period,
    inspected.plan,
  );
  return {
    mode,
    applied: applied.length > 0,
    appliedRepairs: applied,
    environment,
    database,
    plan: inspected.plan,
    externalSideEffects: "BLOCKED_BY_DESIGN",
  };
}

async function main() {
  const mode = parseCanonicalPrepareMode(process.argv.slice(2));
  const prisma = new PrismaClient();
  try {
    console.log(safeJson(await runCanonicalPhase2Repair(prisma, mode)));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("repair-testing-canonical-uat-phase2.ts")) {
  void main();
}
