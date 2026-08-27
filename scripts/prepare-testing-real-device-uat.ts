import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { installClaimCategoryStarters } from "../src/lib/claim/service";
import {
  generateLeaveEntitlementsForYear,
  installCompanyLeaveStarter,
  upsertEmployeeLeaveBalance,
} from "../src/lib/leave/service";
import { saveEmployeeRosterSchedule } from "../src/lib/roster/employee-schedule-service";
import { saveRosterShiftTemplate } from "../src/lib/roster/shift-template-service";
import {
  ensureRosterPeriod,
  publishRoster,
  upsertRosterAssignment,
  type RosterServiceContext,
} from "../src/lib/roster/service";

const prisma = new PrismaClient();

const TESTING_BUSINESS = "Royal Salon";
const TESTING_BRANCH = "salon online";
const EMPLOYEE_PHONE = "+601112212259";
const MANAGER_PHONE = "+601151300932";
const HR_EMAIL = "real-device-uat.hr@tetamu.local";
const UAT_DATE = new Date("2026-08-26T00:00:00.000Z");
const UAT_WEEK_START = new Date("2026-08-24T00:00:00.000Z");
const UAT_ANNUAL_LEAVE_SOURCE_KEY = "a032ae95-4d6c-4a72-95a9-d7e3a243c3d7";

const managerPermissions = [
  "APPROVE_LEAVE",
  "REVIEW_CLAIM",
  "ATTENDANCE_EMPLOYEE_READ",
  "ATTENDANCE_EMPLOYEE_MANAGE",
  "ROSTER_VIEW",
] as const;

const hrPermissions = [
  "ALL_BRANCHES",
  "ATTENDANCE_EMPLOYEE_READ",
  "ATTENDANCE_EMPLOYEE_MANAGE",
  "ROSTER_VIEW",
  "VIEW_LEAVE",
  "APPROVE_LEAVE",
  "VIEW_CLAIM",
  "REVIEW_CLAIM",
  "VIEW_COMPENSATION",
  "VIEW_PAYROLL_RUN",
  "CREATE_PAYROLL_RUN",
  "EDIT_PAYROLL_ENTRY",
  "SUBMIT_PAYROLL_REVIEW",
  "RETURN_PAYROLL_TO_DRAFT",
  "APPROVE_PAYROLL",
  "VIEW_PAYSLIP",
  "PUBLISH_PAYSLIP",
  "PAYROLL_READ",
] as const;

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("REAL_DEVICE_UAT_REQUIRES_RAILWAY_TESTING_ENVIRONMENT");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("REAL_DEVICE_UAT_REQUIRES_TESTING_DESKTOP_SERVICE");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (hostname !== "postgres-singapore.railway.internal") {
    throw new Error("REAL_DEVICE_UAT_DATABASE_HOST_IS_NOT_THE_APPROVED_TESTING_DATABASE");
  }
  const password = process.env.REAL_DEVICE_UAT_HR_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("REAL_DEVICE_UAT_HR_PASSWORD_MUST_BE_AT_LEAST_16_CHARACTERS");
  }
  return password;
}

async function main() {
  const hrPassword = assertTestingBoundary();
  const business = await prisma.business.findFirstOrThrow({
    where: { name: TESTING_BUSINESS, slug: "salon-online", status: "active" },
    select: { id: true, name: true, slug: true, industryType: true },
  });
  const branch = await prisma.branch.findFirstOrThrow({
    where: { businessId: business.id, name: TESTING_BRANCH, status: "ACTIVE" },
    include: { attendanceSetting: true },
  });
  if (!branch.attendanceSetting?.isEnabled) {
    throw new Error("TESTING_BRANCH_ATTENDANCE_IS_NOT_ENABLED");
  }

  const employee = await prisma.employeeBusinessMembership.findFirstOrThrow({
    where: {
      businessId: business.id,
      status: "ACTIVE",
      employeeAccount: { is: { phoneNormalized: EMPLOYEE_PHONE } },
    },
    include: {
      employeeAccount: true,
      staffUser: true,
      branchAssignments: { where: { status: "ACTIVE" } },
    },
  });
  if (!employee.staffUser) throw new Error("UAT_EMPLOYEE_STAFF_APP_LINK_IS_MISSING");
  if (!employee.branchAssignments.some((assignment) => assignment.branchId === branch.id)) {
    throw new Error("UAT_EMPLOYEE_BRANCH_ASSIGNMENT_IS_MISSING");
  }

  const manager = await prisma.employeeBusinessMembership.findFirstOrThrow({
    where: {
      businessId: business.id,
      status: "ACTIVE",
      employeeAccount: { is: { phoneNormalized: MANAGER_PHONE } },
    },
    include: {
      employeeAccount: true,
      staffUser: true,
      branchAssignments: { where: { status: "ACTIVE" } },
    },
  });
  if (!manager.staffUser) throw new Error("UAT_MANAGER_STAFF_APP_LINK_IS_MISSING");
  if (!manager.branchAssignments.some((assignment) => assignment.branchId === branch.id)) {
    throw new Error("UAT_MANAGER_BRANCH_ASSIGNMENT_IS_MISSING");
  }

  const prepared = await prisma.$transaction(async (tx) => {
    const employeeCodeConflict = await tx.employeeBusinessMembership.findFirst({
      where: {
        businessId: business.id,
        employeeCode: "TWILIO-OTP-QA",
        id: { not: employee.id },
      },
      select: { id: true },
    });
    if (employeeCodeConflict) {
      const archived = await tx.employeeBusinessMembership.findUniqueOrThrow({
        where: { id: employeeCodeConflict.id },
        select: { status: true },
      });
      if (archived.status !== "TERMINATED") {
        throw new Error("TWILIO_OTP_QA_EMPLOYEE_CODE_IS_USED_BY_AN_ACTIVE_MEMBERSHIP");
      }
      await tx.employeeBusinessMembership.update({
        where: { id: employeeCodeConflict.id },
        data: { employeeCode: "ARCHIVED-TWILIO-OTP-QA" },
      });
    }

    await tx.employeeAccount.update({
      where: { id: employee.employeeAccountId },
      data: { name: "Twilio OTP QA Staff" },
    });
    await tx.employeeBusinessMembership.update({
      where: { id: employee.id },
      data: { fullName: "Twilio OTP QA Staff", employeeCode: "TWILIO-OTP-QA" },
    });
    await tx.user.update({
      where: { id: employee.staffUser!.id },
      data: { name: "Twilio OTP QA Staff", status: "active", loginEnabled: true },
    });

    const managerProfile = await tx.staffRoleProfile.upsert({
      where: { businessId_name: { businessId: business.id, name: "Real Device UAT Manager" } },
      update: { permissions: [...managerPermissions], active: true },
      create: {
        businessId: business.id,
        name: "Real Device UAT Manager",
        permissions: [...managerPermissions],
        active: true,
      },
    });
    await tx.employeeAccount.update({
      where: { id: manager.employeeAccountId },
      data: { name: "Real Device UAT Manager" },
    });
    await tx.employeeBusinessMembership.update({
      where: { id: manager.id },
      data: { fullName: "Real Device UAT Manager" },
    });
    const managerUser = await tx.user.update({
      where: { id: manager.staffUser!.id },
      data: {
        name: "Real Device UAT Manager",
        businessId: business.id,
        branchId: branch.id,
        role: "STAFF",
        permissions: [...managerPermissions],
        staffRoleProfileId: managerProfile.id,
        status: "active",
        loginEnabled: true,
      },
    });

    const hrProfile = await tx.staffRoleProfile.upsert({
      where: { businessId_name: { businessId: business.id, name: "Real Device UAT HR" } },
      update: { permissions: [...hrPermissions], active: true },
      create: {
        businessId: business.id,
        name: "Real Device UAT HR",
        permissions: [...hrPermissions],
        active: true,
      },
    });
    const passwordHash = await bcrypt.hash(hrPassword, 10);
    const hrUser = await tx.user.upsert({
      where: { email: HR_EMAIL },
      update: {
        businessId: business.id,
        branchId: branch.id,
        name: "Real Device UAT HR",
        passwordHash,
        loginEnabled: true,
        role: "STAFF",
        permissions: [...hrPermissions],
        staffRoleProfileId: hrProfile.id,
        status: "active",
      },
      create: {
        businessId: business.id,
        branchId: branch.id,
        name: "Real Device UAT HR",
        email: HR_EMAIL,
        passwordHash,
        loginEnabled: true,
        role: "STAFF",
        permissions: [...hrPermissions],
        staffRoleProfileId: hrProfile.id,
        status: "active",
      },
    });
    return { managerProfile, managerUser, hrProfile, hrUser };
  });

  const actor = {
    userId: prepared.hrUser.id,
    name: prepared.hrUser.name,
    email: prepared.hrUser.email!,
  };
  const appSession = {
    ...actor,
    homeBusinessId: business.id,
    activeBusinessId: business.id,
    contextVersion: 1,
    businessId: business.id,
    industryType: business.industryType,
    branchId: branch.id,
    role: "STAFF" as const,
    permissions: [...hrPermissions],
    status: "active" as const,
  };

  await installCompanyLeaveStarter(business.id, prepared.hrUser.id);
  const leaveEntitlements = await generateLeaveEntitlementsForYear({
    businessId: business.id,
    actor: appSession,
    year: 2026,
  });
  const annualLeavePolicy = await prisma.leavePolicy.findFirstOrThrow({
    where: { businessId: business.id, code: "ANNUAL", active: true },
    select: { id: true },
  });
  const annualLeaveLedgerSource = `leave-adjustment:${business.id}:${UAT_ANNUAL_LEAVE_SOURCE_KEY}`;
  const existingUatLeaveAdjustment = await prisma.leaveBalanceLedgerEntry.findUnique({
    where: { sourceKey: annualLeaveLedgerSource },
    select: { id: true },
  });
  if (!existingUatLeaveAdjustment) {
    await upsertEmployeeLeaveBalance({
      businessId: business.id,
      allowedBranchIds: [branch.id],
      actor: appSession,
      rawInput: {
        membershipId: employee.id,
        policyId: annualLeavePolicy.id,
        year: 2026,
        units: 5,
        reason: "Testing only Real Device UAT leave balance",
        sourceKey: UAT_ANNUAL_LEAVE_SOURCE_KEY,
      },
    });
  }
  const claimStarters = await installClaimCategoryStarters({ businessId: business.id, actor });

  const rosterContext: RosterServiceContext = {
    businessId: business.id,
    allowedBranchIds: [branch.id],
    actor,
    canAmendPublished: true,
    canManageRetrospective: true,
  };
  let shift = await prisma.rosterShiftTemplate.findFirst({
    where: { businessId: business.id, branchId: branch.id, name: "Real Device UAT Shift" },
  });
  if (!shift) {
    shift = await saveRosterShiftTemplate({
      context: rosterContext,
      input: {
        branchId: branch.id,
        name: "Real Device UAT Shift",
        shortCode: "UAT",
        startMinute: 9 * 60,
        endMinute: 18 * 60,
        breakMinutes: 60,
        breakPaid: false,
        colorToken: "TEAL",
        active: true,
      },
    });
  }

  const existingSchedule = await prisma.employeeRosterScheduleVersion.findFirst({
    where: { businessId: business.id, branchId: branch.id, membershipId: employee.id },
    orderBy: [{ effectiveFrom: "desc" }, { revision: "desc" }],
  });
  if (!existingSchedule) {
    await saveEmployeeRosterSchedule({
      context: rosterContext,
      input: {
        branchId: branch.id,
        membershipId: employee.id,
        effectiveFrom: new Date("2026-08-24T00:00:00.000Z"),
        defaultShiftTemplateId: shift.id,
        restPolicy: "FIXED",
        fixedRestWeekdays: [6, 7],
        requiredRestDays: 2,
      },
    });
  }

  let period = await ensureRosterPeriod({
    context: rosterContext,
    branchId: branch.id,
    weekStart: UAT_WEEK_START,
  });
  const existingAssignment = await prisma.rosterAssignment.findFirst({
    where: {
      rosterPeriodId: period.id,
      membershipId: employee.id,
      workDate: UAT_DATE,
    },
  });
  if (!existingAssignment) {
    await upsertRosterAssignment({
      context: rosterContext,
      input: {
        branchId: branch.id,
        weekStart: UAT_WEEK_START,
        expectedDraftRevision: period.draftRevision,
        membershipId: employee.id,
        workDate: UAT_DATE,
        kind: "WORK_SHIFT",
        shiftTemplateId: shift.id,
        breakMinutes: 60,
        note: "Testing only — Real Device UAT",
      },
    });
  }

  period = await prisma.rosterPeriod.findUniqueOrThrow({ where: { id: period.id } });
  let rosterPublicationError: string | null = null;
  if (period.publicationRevision === 0) {
    try {
      await publishRoster({
        context: rosterContext,
        input: {
          rosterPeriodId: period.id,
          expectedDraftRevision: period.draftRevision,
          operationKey: `real-device-uat-${period.id}`,
          reason: "Testing only Real Device UAT roster",
        },
      });
    } catch (error) {
      rosterPublicationError = error instanceof Error ? error.message : String(error);
    }
  }

  const verification = await prisma.employeeBusinessMembership.findUniqueOrThrow({
    where: { id: employee.id },
    include: {
      employeeAccount: true,
      staffUser: true,
      branchAssignments: { where: { status: "ACTIVE" } },
      payrollPayslipPublications: { select: { id: true, payrollRunId: true, publishedAt: true } },
    },
  });
  const employeeEntitlements = await prisma.employeeLeaveEntitlement.findMany({
    where: {
      businessId: business.id,
      membershipId: verification.id,
      leaveYearStart: { lte: new Date("2026-12-31T00:00:00.000Z") },
      leaveYearEnd: { gte: new Date("2026-01-01T00:00:00.000Z") },
    },
    select: { id: true, policyId: true, leaveYearStart: true, leaveYearEnd: true, entitledUnits: true },
  });
  const employeeLeaveLedger = await prisma.leaveBalanceLedgerEntry.findMany({
    where: {
      businessId: business.id,
      membershipId: verification.id,
      leaveYearStart: { lte: new Date("2026-12-31T00:00:00.000Z") },
    },
    select: { id: true, policyId: true, eventType: true, units: true, reason: true },
  });
  const verifiedPeriod = await prisma.rosterPeriod.findUniqueOrThrow({
    where: { id: period.id },
    include: { assignments: true, publications: true },
  });
  const claimCategories = await prisma.claimCategory.findMany({
    where: { businessId: business.id },
    include: { policyRevisions: { orderBy: { revision: "desc" }, take: 1 } },
  });
  const lockedTimesheets = await prisma.attendanceMonthlyTimesheet.findMany({
    where: { businessId: business.id, status: "LOCKED" },
    select: { id: true, periodStart: true, currentRevisionId: true },
  });

  console.log(JSON.stringify({
    environment: process.env.RAILWAY_ENVIRONMENT_NAME,
    databaseHost: new URL(process.env.DATABASE_URL!).hostname,
    business: { id: business.id, name: business.name },
    branch: {
      id: branch.id,
      name: branch.name,
      timezone: branch.attendanceSetting.timezone,
      latitude: branch.attendanceSetting.latitude,
      longitude: branch.attendanceSetting.longitude,
      geofenceRadiusMeters: branch.attendanceSetting.geofenceRadiusMeters,
      requireGeofence: branch.attendanceSetting.requireGeofence,
    },
    employee: {
      accountId: verification.employeeAccountId,
      membershipId: verification.id,
      staffUserId: verification.staffUser?.id,
      name: verification.fullName,
      employeeCode: verification.employeeCode,
      phone: verification.employeeAccount.phoneNormalized,
      branchIds: verification.branchAssignments.map((item) => item.branchId),
      entitlementIds: employeeEntitlements.map((item) => item.id),
      payslipPublicationIds: verification.payrollPayslipPublications.map((item) => item.id),
    },
    manager: {
      accountId: manager.employeeAccountId,
      membershipId: manager.id,
      employeeCode: manager.employeeCode,
      status: manager.status,
      branchIds: manager.branchAssignments.map((item) => item.branchId),
      staffUserId: prepared.managerUser.id,
      name: prepared.managerUser.name,
      phone: MANAGER_PHONE,
      roleProfileName: prepared.managerProfile.name,
      roleProfileId: prepared.managerProfile.id,
      permissions: prepared.managerUser.permissions,
    },
    hr: {
      userId: prepared.hrUser.id,
      name: prepared.hrUser.name,
      email: prepared.hrUser.email,
      status: prepared.hrUser.status,
      roleProfileName: prepared.hrProfile.name,
      roleProfileId: prepared.hrProfile.id,
      permissions: prepared.hrUser.permissions,
    },
    leave: {
      generation: leaveEntitlements,
      employeeEntitlements,
      employeeLedger: employeeLeaveLedger,
    },
    claims: {
      starters: claimStarters,
      categories: claimCategories.map((category) => ({
        id: category.id,
        code: category.code,
        policyRevisionId: category.policyRevisions[0]?.id ?? null,
        treatment: category.policyRevisions[0]?.statutoryTreatmentStatus ?? null,
      })),
    },
    roster: {
      shiftTemplateId: shift.id,
      periodId: verifiedPeriod.id,
      weekStart: verifiedPeriod.weekStart,
      draftRevision: verifiedPeriod.draftRevision,
      publicationRevision: verifiedPeriod.publicationRevision,
      assignmentIds: verifiedPeriod.assignments.map((item) => item.id),
      publicationIds: verifiedPeriod.publications.map((item) => item.id),
      publicationError: rosterPublicationError,
    },
    payrollPrerequisites: {
      lockedTimesheets,
      publishedPayslipCount: verification.payrollPayslipPublications.length,
    },
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
