import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import type { AppSession } from "../src/lib/auth/session";
import { generateLeaveEntitlementsForYear } from "../src/lib/leave/service";
import { ensureEffectiveRosterExpectedDayInTransaction } from "../src/lib/roster/service";

const prisma = new PrismaClient();

const BUSINESS_SLUG = "qa-hr-payroll-mvp-pilot";
const OWNER_EMAIL = "hr-payroll-pilot.owner@tetamu.local";
const PILOT_MONTH = "2026-08";
const EFFECTIVE_FROM = new Date("2026-08-01T00:00:00.000Z");

const employees = [
  ["PILOT-A", "Pilot A - Normal Attendance", "+60119991001", "Normal attendance"],
  ["PILOT-B", "Pilot B - Late Arrival", "+60119991002", "Late arrival"],
  ["PILOT-C", "Pilot C - Missing Punch", "+60119991003", "Missing punch correction"],
  ["PILOT-D", "Pilot D - Annual Leave", "+60119991004", "Annual leave"],
  ["PILOT-E", "Pilot E - Unpaid Leave", "+60119991005", "Unpaid leave"],
  ["PILOT-F", "Pilot F - Approved OT", "+60119991006", "Approved overtime"],
  ["PILOT-G", "Pilot G - Rest Day Work", "+60119991007", "Rest day work"],
  ["PILOT-H", "Pilot H - Public Holiday Work", "+60119991008", "Public holiday work"],
] as const;

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("HR_PAYROLL_PILOT_FIXTURE_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error("HR_PAYROLL_PILOT_FIXTURE_REQUIRES_LOCAL_DATABASE");
  }
  const password = process.env.HR_PAYROLL_PILOT_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HR_PAYROLL_PILOT_PASSWORD_MUST_BE_AT_LEAST_12_CHARACTERS");
  }
  return password;
}

async function main() {
  const password = assertLocalOnly();
  const passwordHash = await bcrypt.hash(password, 10);

  const result = await prisma.$transaction(async (transaction) => {
    const business = await transaction.business.upsert({
      where: { slug: BUSINESS_SLUG },
      create: {
        name: "Tetamu HR Payroll MVP Pilot",
        slug: BUSINESS_SLUG,
        industryType: "GENERAL_SERVICE",
        timezone: "Asia/Kuala_Lumpur",
      },
      update: {
        name: "Tetamu HR Payroll MVP Pilot",
        status: "active",
        timezone: "Asia/Kuala_Lumpur",
      },
    });

    let branch = await transaction.branch.findFirst({
      where: { businessId: business.id, name: "Pilot Main Branch" },
    });
    branch ??= await transaction.branch.create({
      data: {
        businessId: business.id,
        name: "Pilot Main Branch",
        countryCode: "MY",
        stateCode: "SBH",
      },
    });
    if (branch.status !== "ACTIVE") {
      branch = await transaction.branch.update({
        where: { id: branch.id },
        data: { status: "ACTIVE" },
      });
    }

    await transaction.branchAttendanceSetting.upsert({
      where: { branchId: branch.id },
      create: {
        businessId: business.id,
        branchId: branch.id,
        latitude: 5.9804,
        longitude: 116.0735,
        requireGeofence: false,
        allowOutsideGeofenceRequest: true,
        timezone: "Asia/Kuala_Lumpur",
        isEnabled: true,
      },
      update: {
        timezone: "Asia/Kuala_Lumpur",
        isEnabled: true,
      },
    });

    const owner = await transaction.user.upsert({
      where: { email: OWNER_EMAIL },
      create: {
        businessId: business.id,
        branchId: branch.id,
        name: "HR Payroll Pilot Owner",
        email: OWNER_EMAIL,
        passwordHash,
        role: "BUSINESS_OWNER",
        status: "active",
        loginEnabled: true,
      },
      update: {
        businessId: business.id,
        branchId: branch.id,
        name: "HR Payroll Pilot Owner",
        passwordHash,
        role: "BUSINESS_OWNER",
        status: "active",
        loginEnabled: true,
      },
    });

    for (const moduleKey of ["HR", "PAYROLL", "CLAIMS", "COMMISSION"] as const) {
      const entitlement = await transaction.businessModuleEntitlement.findUnique({
        where: { businessId_moduleKey: { businessId: business.id, moduleKey } },
      });
      if (!entitlement) {
        await transaction.businessModuleEntitlement.create({ data: {
          businessId: business.id,
          moduleKey,
          status: "ENABLED",
          enabledFrom: EFFECTIVE_FROM,
          source: "SYSTEM",
          planCode: "LOCAL_HR_PAYROLL_MVP_PILOT",
          createdById: owner.id,
          updatedById: owner.id,
        } });
      } else if (
        entitlement.status !== "ENABLED" ||
        entitlement.enabledUntil !== null ||
        entitlement.planCode !== "LOCAL_HR_PAYROLL_MVP_PILOT"
      ) {
        await transaction.businessModuleEntitlement.update({
          where: { id: entitlement.id },
          data: {
          status: "ENABLED",
          enabledFrom: EFFECTIVE_FROM,
          enabledUntil: null,
          source: "SYSTEM",
          planCode: "LOCAL_HR_PAYROLL_MVP_PILOT",
          revision: { increment: 1 },
          updatedById: owner.id,
          },
        });
      }
    }

    let shiftTemplate = await transaction.rosterShiftTemplate.findFirst({
      where: { businessId: business.id, branchId: branch.id, name: "Pilot Day Shift", active: true },
      orderBy: { revision: "desc" },
    });
    shiftTemplate ??= await transaction.rosterShiftTemplate.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        name: "Pilot Day Shift",
        shortCode: "DAY",
        startMinute: 9 * 60,
        endMinute: 18 * 60,
        breakMinutes: 60,
        breakPaid: false,
        colorToken: "TEAL",
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    for (const leaveType of [
      {
        code: "ANNUAL",
        name: "Annual leave (Pilot company policy)",
        payTreatment: "PAID" as const,
        balanceTracked: true,
        defaultEntitlementDays: 8,
      },
      {
        code: "UNPAID",
        name: "Unpaid leave",
        payTreatment: "UNPAID" as const,
        balanceTracked: false,
        defaultEntitlementDays: null,
      },
    ]) {
      const policy = await transaction.leavePolicy.upsert({
        where: { businessId_code: { businessId: business.id, code: leaveType.code } },
        create: {
          businessId: business.id,
          code: leaveType.code,
          name: leaveType.name,
          payTreatment: leaveType.payTreatment,
          countMode: "WEEKDAYS",
          balanceTracked: leaveType.balanceTracked,
          defaultEntitlementDays: leaveType.defaultEntitlementDays,
          origin: "BUSINESS_CUSTOM",
          legalStatus: "COMPANY_POLICY_ONLY",
        },
        update: {
          active: true,
          name: leaveType.name,
          payTreatment: leaveType.payTreatment,
          countMode: "WEEKDAYS",
          balanceTracked: leaveType.balanceTracked,
          defaultEntitlementDays: leaveType.defaultEntitlementDays,
          origin: "BUSINESS_CUSTOM",
          legalStatus: "COMPANY_POLICY_ONLY",
        },
      });
      const version = await transaction.leavePolicyVersion.findFirst({
        where: {
          businessId: business.id,
          policyId: policy.id,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          legalStatus: "COMPANY_POLICY_ONLY",
        },
      });
      if (!version) {
        const latest = await transaction.leavePolicyVersion.findFirst({
          where: { businessId: business.id, policyId: policy.id },
          orderBy: { revision: "desc" },
          select: { revision: true },
        });
        await transaction.leavePolicyVersion.create({
          data: {
            businessId: business.id,
            policyId: policy.id,
            revision: (latest?.revision ?? 0) + 1,
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            nameSnapshot: leaveType.name,
            payTreatment: leaveType.payTreatment,
            countMode: "WEEKDAYS",
            balanceTracked: leaveType.balanceTracked,
            defaultEntitlementDays: leaveType.defaultEntitlementDays,
            origin: "BUSINESS_CUSTOM",
            legalStatus: "COMPANY_POLICY_ONLY",
            sourceReference: "LOCAL_HR_PAYROLL_MVP_PILOT",
            reason: "LOCAL / TESTING ONLY company policy for HR Payroll MVP Pilot acceptance; not a statutory rule.",
            createdById: owner.id,
          },
        });
      }
    }

    const membershipIds: string[] = [];
    for (const [employeeCode, fullName, phone, position] of employees) {
      const account = await transaction.employeeAccount.upsert({
        where: { phoneNormalized: phone },
        create: { name: fullName, phoneNumber: phone, phoneNormalized: phone },
        update: { name: fullName, phoneNumber: phone, status: "ACTIVE" },
      });
      const membership = await transaction.employeeBusinessMembership.upsert({
        where: { businessId_employeeCode: { businessId: business.id, employeeCode } },
        create: {
          employeeAccountId: account.id,
          businessId: business.id,
          employeeCode,
          fullName,
          phoneNumber: phone,
          phoneNumberNormalized: phone,
          employmentType: "DAILY",
          status: "ACTIVE",
          attendanceEnabled: true,
          payBasis: "DAILY",
          baseSalary: 120,
          normalWorkMinutesPerDay: 480,
          targetBreakMinutes: 60,
          joinedAt: EFFECTIVE_FROM,
          position,
        },
        update: {
          employeeAccountId: account.id,
          fullName,
          phoneNumber: phone,
          phoneNumberNormalized: phone,
          employmentType: "DAILY",
          status: "ACTIVE",
          attendanceEnabled: true,
          payBasis: "DAILY",
          baseSalary: 120,
          normalWorkMinutesPerDay: 480,
          targetBreakMinutes: 60,
          terminatedAt: null,
          position,
        },
      });
      membershipIds.push(membership.id);

      const assignment = await transaction.employeeBranchAssignment.findFirst({
        where: { membershipId: membership.id, branchId: branch.id, status: "ACTIVE" },
      });
      if (assignment) {
        await transaction.employeeBranchAssignment.update({
          where: { id: assignment.id },
          data: { isPrimary: true, canClockIn: true, effectiveUntil: null },
        });
      } else {
        await transaction.employeeBranchAssignment.create({
          data: {
            membershipId: membership.id,
            businessId: business.id,
            branchId: branch.id,
            isPrimary: true,
            canClockIn: true,
            effectiveFrom: EFFECTIVE_FROM,
          },
        });
      }

      const compensation = await transaction.employeeCompensationVersion.findFirst({
        where: {
          businessId: business.id,
          membershipId: membership.id,
          effectiveFromMonth: EFFECTIVE_FROM,
          status: "ACTIVE",
        },
      });
      if (!compensation) {
        await transaction.employeeCompensationVersion.create({
          data: {
            businessId: business.id,
            membershipId: membership.id,
            effectiveFromMonth: EFFECTIVE_FROM,
            payBasis: "DAILY",
            baseRate: 120,
            source: "MANUAL",
            reasonType: "OTHER",
            reasonNote: "LOCAL / TESTING ONLY HR Payroll MVP Pilot baseline.",
            createdById: owner.id,
          },
        });
      }

      const existingSchedule = await transaction.employeeRosterScheduleVersion.findFirst({
        where: {
          businessId: business.id,
          branchId: branch.id,
          membershipId: membership.id,
          effectiveFrom: EFFECTIVE_FROM,
        },
      });
      if (!existingSchedule) {
        await transaction.employeeRosterScheduleVersion.create({
          data: {
            businessId: business.id,
            branchId: branch.id,
            membershipId: membership.id,
            effectiveFrom: EFFECTIVE_FROM,
            revision: 1,
            defaultShiftTemplateId: shiftTemplate.id,
            shiftNameSnapshot: shiftTemplate.name,
            shiftShortCodeSnapshot: shiftTemplate.shortCode,
            shiftColorSnapshot: shiftTemplate.colorToken,
            startMinuteSnapshot: shiftTemplate.startMinute,
            endMinuteSnapshot: shiftTemplate.endMinute,
            crossMidnightSnapshot: shiftTemplate.crossMidnight,
            breakMinutesSnapshot: shiftTemplate.breakMinutes,
            breakPaidSnapshot: shiftTemplate.breakPaid,
            restPolicy: "FIXED",
            fixedRestWeekdays: [7],
            requiredRestDays: 1,
            sourceDigest: `pilot-${employeeCode}`.padEnd(64, "0").slice(0, 64),
            createdById: owner.id,
          },
        });
      }
    }

    let expectedAttendanceDays = 0;
    for (const membershipId of membershipIds) {
      for (let day = 1; day <= 31; day += 1) {
        const expectedDay = await ensureEffectiveRosterExpectedDayInTransaction({
          businessId: business.id,
          branchId: branch.id,
          membershipId,
          workDate: new Date(Date.UTC(2026, 7, day)),
          transaction,
        });
        if (expectedDay) expectedAttendanceDays += 1;
      }
    }

    return {
      businessId: business.id,
      branchId: branch.id,
      ownerId: owner.id,
      shiftTemplateId: shiftTemplate.id,
      employeeCount: membershipIds.length,
      expectedAttendanceDays,
    };
  }, { timeout: 60_000 });

  const entitlementActor: AppSession = {
    userId: result.ownerId,
    homeBusinessId: result.businessId,
    activeBusinessId: result.businessId,
    contextVersion: 1,
    businessId: result.businessId,
    branchId: result.branchId,
    name: "HR Payroll Pilot Owner",
    email: OWNER_EMAIL,
    role: "BUSINESS_OWNER",
    permissions: [],
    status: "active",
  };
  const leaveEntitlements = await generateLeaveEntitlementsForYear({
    businessId: result.businessId,
    actor: entitlementActor,
    year: 2026,
  });

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessSlug: BUSINESS_SLUG,
    ownerEmail: OWNER_EMAIL,
    pilotMonth: PILOT_MONTH,
    leaveEntitlements,
    ...result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
