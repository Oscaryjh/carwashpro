import { Prisma, PrismaClient } from "@prisma/client";
import { createAttendanceEmployee } from "../src/lib/attendance/employee-service";
import { findEligibleEmployeeIdentityByPhone } from "../src/lib/attendance/employee-auth/membership";
import {
  hasBusinessCapability,
  resolveBusinessAccess,
} from "../src/lib/business-groups/business-access";
import { writeEmployeeCompensationVersionInTransaction } from "../src/lib/payroll/compensation-version";

const prisma = new PrismaClient();

const APPLY = process.argv.includes("--apply");
const BUSINESS_NAME = "Payroll UAT Business";
const BUSINESS_SLUG = "payroll-uat-business";
const BRANCH_NAME = "Payroll UAT Branch";
const EMPLOYEE_NAME = "Real Device Payroll UAT Staff";
const EMPLOYEE_CODE = "UAT-PAYROLL-001";
const EMPLOYEE_PHONE = "+60128793848";
const ROYAL_SALON_MEMBERSHIP_ID = "72f21dad-66d0-45fc-a326-2a8c5f55ffdb";
const OWNER_EMAIL = "payroll-uat.owner@tetamu.local";
const SOURCE_UAT_HR_EMAIL = "real-device-uat.hr@tetamu.local";
const JOINED_AT = new Date("2026-07-01T00:00:00.000Z");
const COMPENSATION_EFFECTIVE = new Date("2026-08-01T00:00:00.000Z");
const TESTING_DATABASE_HOST = "postgres-singapore.railway.internal";
const REQUIRED_MODULES = ["HR", "PAYROLL"] as const;

function assertTestingBoundary() {
  if (process.env.RAILWAY_ENVIRONMENT_NAME !== "testing") {
    throw new Error("ISOLATED_PAYROLL_UAT_REQUIRES_RAILWAY_TESTING_ENVIRONMENT");
  }
  if (process.env.RAILWAY_SERVICE_NAME !== "tetamu-pos-web") {
    throw new Error("ISOLATED_PAYROLL_UAT_REQUIRES_TESTING_DESKTOP_SERVICE");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_IS_REQUIRED");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  const approvedTestingDatabase =
    hostname === TESTING_DATABASE_HOST || hostname.endsWith(".proxy.rlwy.net");
  if (!approvedTestingDatabase) {
    throw new Error("ISOLATED_PAYROLL_UAT_DATABASE_IS_NOT_APPROVED_TESTING_DATABASE");
  }
}

async function inspectExistingIdentity() {
  const account = await prisma.employeeAccount.findUnique({
    where: { phoneNormalized: EMPLOYEE_PHONE },
    include: {
      memberships: {
        include: {
          business: { select: { id: true, name: true, slug: true, status: true } },
          branchAssignments: {
            include: {
              branch: { select: { id: true, name: true, status: true } },
            },
          },
          compensationVersions: true,
        },
      },
    },
  });
  if (!account) throw new Error("TARGET_GLOBAL_EMPLOYEE_ACCOUNT_NOT_FOUND");
  if (account.status !== "ACTIVE") throw new Error("TARGET_GLOBAL_EMPLOYEE_ACCOUNT_NOT_ACTIVE");
  if (account.name !== EMPLOYEE_NAME) throw new Error("TARGET_GLOBAL_EMPLOYEE_NAME_MISMATCH");

  const royalMembership = account.memberships.find(
    (membership) => membership.id === ROYAL_SALON_MEMBERSHIP_ID,
  );
  if (!royalMembership || royalMembership.business.name !== "Royal Salon") {
    throw new Error("ROYAL_SALON_MEMBERSHIP_CONTRACT_MISMATCH");
  }

  return { account, royalMembership };
}

async function inspectBusiness() {
  const candidates = await prisma.business.findMany({
    where: { OR: [{ name: BUSINESS_NAME }, { slug: BUSINESS_SLUG }] },
    include: {
      branches: { include: { attendanceSetting: true } },
      employeeMemberships: {
        include: {
          employeeAccount: true,
          branchAssignments: true,
          compensationVersions: true,
        },
      },
      moduleEntitlements: true,
      users: true,
    },
  });
  if (candidates.length > 1) throw new Error("PAYROLL_UAT_BUSINESS_IDENTITY_CONFLICT");
  const business = candidates[0] ?? null;
  if (business && (business.name !== BUSINESS_NAME || business.slug !== BUSINESS_SLUG)) {
    throw new Error("PAYROLL_UAT_BUSINESS_NAME_OR_SLUG_CONFLICT");
  }
  return business;
}

async function createOrLoadFoundation(passwordHash: string) {
  return prisma.$transaction(async (tx) => {
    let business = await tx.business.findUnique({ where: { slug: BUSINESS_SLUG } });
    if (!business) {
      business = await tx.business.create({
        data: {
          name: BUSINESS_NAME,
          slug: BUSINESS_SLUG,
          industryType: "GENERAL_SERVICE",
          timezone: "Asia/Kuching",
          language: "EN",
          status: "active",
        },
      });
    } else if (
      business.name !== BUSINESS_NAME ||
      business.status !== "active" ||
      business.timezone !== "Asia/Kuching" ||
      business.industryType !== "GENERAL_SERVICE"
    ) {
      throw new Error("EXISTING_PAYROLL_UAT_BUSINESS_CONFIGURATION_MISMATCH");
    }

    const existingBranches = await tx.branch.findMany({ where: { businessId: business.id } });
    if (existingBranches.some((branch) => branch.name !== BRANCH_NAME)) {
      throw new Error("PAYROLL_UAT_BUSINESS_HAS_UNEXPECTED_BRANCH");
    }
    let branch = existingBranches.find((candidate) => candidate.name === BRANCH_NAME) ?? null;
    if (!branch) {
      branch = await tx.branch.create({
        data: {
          businessId: business.id,
          name: BRANCH_NAME,
          countryCode: "MY",
          status: "ACTIVE",
        },
      });
    } else if (branch.status !== "ACTIVE" || branch.countryCode !== "MY") {
      throw new Error("EXISTING_PAYROLL_UAT_BRANCH_CONFIGURATION_MISMATCH");
    }

    await tx.branchAttendanceSetting.upsert({
      where: { branchId: branch.id },
      update: {
        businessId: business.id,
        isEnabled: true,
        requireGeofence: false,
        allowOutsideGeofenceRequest: true,
        timezone: "Asia/Kuching",
      },
      create: {
        businessId: business.id,
        branchId: branch.id,
        latitude: new Prisma.Decimal(0),
        longitude: new Prisma.Decimal(0),
        geofenceRadiusMeters: 100,
        minimumAccuracyMeters: 80,
        requireGeofence: false,
        allowOutsideGeofenceRequest: true,
        requirePhoto: false,
        targetBreakMinutes: 60,
        normalWorkMinutesPerDay: 480,
        shiftSpanMinutes: 540,
        timezone: "Asia/Kuching",
        isEnabled: true,
      },
    });

    const owner = await tx.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {
        businessId: business.id,
        branchId: branch.id,
        name: "Payroll UAT Owner",
        passwordHash,
        loginEnabled: true,
        role: "BUSINESS_OWNER",
        permissions: [],
        status: "active",
      },
      create: {
        businessId: business.id,
        branchId: branch.id,
        name: "Payroll UAT Owner",
        email: OWNER_EMAIL,
        passwordHash,
        loginEnabled: true,
        role: "BUSINESS_OWNER",
        permissions: [],
        status: "active",
      },
    });
    if (!owner.email) throw new Error("PAYROLL_UAT_OWNER_EMAIL_IS_REQUIRED");

    const now = new Date();
    for (const moduleKey of REQUIRED_MODULES) {
      const existing = await tx.businessModuleEntitlement.findUnique({
        where: { businessId_moduleKey: { businessId: business.id, moduleKey } },
      });
      if (existing?.status === "ENABLED" && existing.enabledFrom <= now && !existing.enabledUntil) {
        continue;
      }
      const revision = (existing?.revision ?? 0) + 1;
      const entitlement = existing
        ? await tx.businessModuleEntitlement.update({
            where: { id: existing.id },
            data: {
              status: "ENABLED",
              enabledFrom: now,
              enabledUntil: null,
              source: "MANUAL",
              planCode: "TESTING_PAYROLL_UAT",
              revision,
              updatedById: owner.id,
            },
          })
        : await tx.businessModuleEntitlement.create({
            data: {
              businessId: business.id,
              moduleKey,
              status: "ENABLED",
              enabledFrom: now,
              enabledUntil: null,
              source: "MANUAL",
              planCode: "TESTING_PAYROLL_UAT",
              revision,
              createdById: owner.id,
              updatedById: owner.id,
            },
          });
      await tx.businessModuleEntitlementEvent.create({
        data: {
          entitlementId: entitlement.id,
          businessId: business.id,
          moduleKey,
          revision,
          oldStatus: existing?.status ?? null,
          newStatus: "ENABLED",
          oldEnabledFrom: existing?.enabledFrom ?? null,
          newEnabledFrom: now,
          oldEnabledUntil: existing?.enabledUntil ?? null,
          newEnabledUntil: null,
          source: "MANUAL",
          planCode: "TESTING_PAYROLL_UAT",
          reason: "Testing-only isolated Payroll and Payslip UAT fixture.",
          actorUserId: owner.id,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        actorUserId: owner.id,
        actorName: owner.name,
        actorEmail: owner.email,
        action: "TESTING_PAYROLL_UAT_FOUNDATION_PREPARED",
        entityType: "Business",
        entityId: business.id,
        summary: "Testing-only isolated Payroll UAT business foundation prepared.",
        metadata: {
          environment: "testing",
          purpose: "REAL_DEVICE_PAYROLL_PAYSLIP_UAT",
        },
      },
    });

    return { business, branch, owner: { ...owner, email: owner.email } };
  });
}

async function ensureMembership(input: {
  businessId: string;
  branchId: string;
  owner: { id: string; name: string; email: string };
  employeeAccountId: string;
}) {
  const existing = await prisma.employeeBusinessMembership.findUnique({
    where: {
      employeeAccountId_businessId: {
        employeeAccountId: input.employeeAccountId,
        businessId: input.businessId,
      },
    },
    include: { branchAssignments: true },
  });
  if (existing) {
    const primary = existing.branchAssignments.filter(
      (assignment) => assignment.status === "ACTIVE" && assignment.isPrimary,
    );
    if (
      existing.employeeCode !== EMPLOYEE_CODE ||
      existing.fullName !== EMPLOYEE_NAME ||
      existing.phoneNumberNormalized !== EMPLOYEE_PHONE ||
      existing.status !== "ACTIVE" ||
      !existing.attendanceEnabled ||
      existing.joinedAt.getTime() !== JOINED_AT.getTime() ||
      primary.length !== 1 ||
      primary[0].branchId !== input.branchId ||
      !primary[0].canClockIn
    ) {
      throw new Error("EXISTING_PAYROLL_UAT_MEMBERSHIP_CONFIGURATION_MISMATCH");
    }
    return existing;
  }

  return createAttendanceEmployee({
    businessId: input.businessId,
    allowedBranchIds: [input.branchId],
    wholeBusinessScope: true,
    actor: {
      userId: input.owner.id,
      name: input.owner.name,
      email: input.owner.email,
    },
    input: {
      businessId: input.businessId,
      employeeCode: EMPLOYEE_CODE,
      fullName: EMPLOYEE_NAME,
      phoneNumber: EMPLOYEE_PHONE,
      joinedAt: JOINED_AT,
      employmentType: "FULL_TIME",
      status: "ACTIVE",
      attendanceEnabled: true,
      payBasis: "MONTHLY",
      baseSalary: null,
      normalWorkMinutesPerDay: null,
      targetBreakMinutes: null,
      assignments: [
        {
          branchId: input.branchId,
          isPrimary: true,
          canClockIn: true,
          effectiveFrom: JOINED_AT,
          effectiveUntil: null,
          status: "ACTIVE",
        },
      ],
    },
  });
}

async function ensureCompensation(input: {
  businessId: string;
  branchId: string;
  membershipId: string;
  owner: { id: string; name: string; email: string };
}) {
  const access = await resolveBusinessAccess({
    userId: input.owner.id,
    requestedBusinessId: input.businessId,
    capability: "EDIT_COMPENSATION",
  });
  if (!access.granted) throw new Error("PAYROLL_UAT_OWNER_COMPENSATION_ACCESS_BLOCKED");

  return prisma.$transaction((tx) =>
    writeEmployeeCompensationVersionInTransaction(
      {
        actor: {
          userId: input.owner.id,
          name: input.owner.name,
          email: input.owner.email,
        },
        authorization: { access, allowedBranchIds: [input.branchId] },
        baseRate: "3000.00",
        businessId: input.businessId,
        effectiveFromMonth: COMPENSATION_EFFECTIVE,
        membershipId: input.membershipId,
        payBasis: "MONTHLY",
        reasonNote: "Initial Testing-only isolated Payroll UAT compensation.",
        reasonType: "OTHER",
        source: "MANUAL",
        projectionMonth: COMPENSATION_EFFECTIVE,
      },
      tx,
    ),
  );
}

async function verify(input: {
  accountId: string;
  businessId: string;
  branchId: string;
  membershipId: string;
  ownerId: string;
}) {
  const [business, identity, access, prohibited] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: input.businessId },
      include: {
        branches: { include: { attendanceSetting: true } },
        employeeMemberships: {
          include: {
            branchAssignments: true,
            compensationVersions: true,
            bankAccountVersions: true,
          },
        },
        moduleEntitlements: true,
        users: true,
      },
    }),
    findEligibleEmployeeIdentityByPhone(EMPLOYEE_PHONE, new Date(), prisma, true),
    resolveBusinessAccess({
      userId: input.ownerId,
      requestedBusinessId: input.businessId,
    }),
    Promise.all([
      prisma.rosterAssignment.count({ where: { businessId: input.businessId } }),
      prisma.employeeAttendance.count({ where: { businessId: input.businessId } }),
      prisma.attendanceExpectedDay.count({ where: { businessId: input.businessId } }),
      prisma.attendanceMonthlyTimesheet.count({ where: { businessId: input.businessId } }),
      prisma.payrollRun.count({ where: { businessId: input.businessId } }),
      prisma.payrollEntry.count({ where: { businessId: input.businessId } }),
      prisma.payrollPayslipPublication.count({ where: { businessId: input.businessId } }),
    ]),
  ]);

  const membership = business.employeeMemberships.find(
    (candidate) => candidate.id === input.membershipId,
  );
  if (!membership) throw new Error("PAYROLL_UAT_MEMBERSHIP_VERIFICATION_FAILED");
  const branch = business.branches.find((candidate) => candidate.id === input.branchId);
  if (!branch) throw new Error("PAYROLL_UAT_BRANCH_VERIFICATION_FAILED");
  const compensation = membership.compensationVersions.find(
    (candidate) =>
      candidate.status === "ACTIVE" &&
      candidate.effectiveFromMonth.getTime() === COMPENSATION_EFFECTIVE.getTime(),
  );
  const selectable = identity?.memberships.some(
    (candidate) => candidate.membershipId === input.membershipId,
  ) ?? false;
  const royalSelectable = identity?.memberships.some(
    (candidate) => candidate.membershipId === ROYAL_SALON_MEMBERSHIP_ID,
  ) ?? false;
  const requiredCapabilities = [
    "VIEW_ROSTER",
    "CREATE_ROSTER",
    "EDIT_ROSTER",
    "PUBLISH_ROSTER",
    "VIEW_PAYROLL_RUN",
    "CREATE_PAYROLL_RUN",
    "SUBMIT_PAYROLL_REVIEW",
    "APPROVE_PAYROLL",
    "VIEW_PAYSLIP",
    "PUBLISH_PAYSLIP",
  ] as const;
  const capabilityChecks = Object.fromEntries(
    requiredCapabilities.map((capability) => [
      capability,
      hasBusinessCapability(access, capability),
    ]),
  );

  const failures: string[] = [];
  if (business.status !== "active") failures.push("BUSINESS_NOT_ACTIVE");
  if (business.branches.length !== 1) failures.push("ACTIVE_BRANCH_ISOLATION_FAILED");
  if (branch.status !== "ACTIVE" || !branch.attendanceSetting?.isEnabled) failures.push("BRANCH_ATTENDANCE_NOT_READY");
  if (business.employeeMemberships.length !== 1) failures.push("PAYROLL_POPULATION_NOT_ISOLATED");
  if (membership.status !== "ACTIVE" || !membership.attendanceEnabled) failures.push("MEMBERSHIP_NOT_READY");
  if (!compensation || compensation.payBasis !== "MONTHLY" || !compensation.baseRate.equals("3000.00")) failures.push("COMPENSATION_NOT_READY");
  if (membership.bankAccountVersions.length !== 0) failures.push("BANK_DATA_MUST_REMAIN_EMPTY");
  if (!selectable || !royalSelectable || identity?.memberships.length !== 2) failures.push("MULTI_BUSINESS_SELECTION_FAILED");
  if (!access.granted || Object.values(capabilityChecks).some((allowed) => !allowed)) failures.push("OWNER_PERMISSION_PREFLIGHT_FAILED");
  if (prohibited.some((count) => count !== 0)) failures.push("PROHIBITED_PAYROLL_FIXTURE_DATA_FOUND");
  if (membership.epfEnabled || membership.socsoEnabled || membership.eisEnabled || membership.lindung24OptIn || membership.pcbProfile) failures.push("STATUTORY_PROFILE_MUST_REMAIN_UNCONFIGURED");

  return {
    failures,
    business,
    branch,
    membership,
    compensation,
    identity,
    access,
    capabilityChecks,
    prohibited,
    payrollEligibleMembershipCount: business.employeeMemberships.filter(
      (candidate) =>
        candidate.status === "ACTIVE" &&
        candidate.joinedAt <= new Date("2026-08-31T23:59:59.999Z") &&
        (!candidate.terminatedAt || candidate.terminatedAt >= new Date("2026-08-01T00:00:00.000Z")) &&
        candidate.compensationVersions.some(
          (version) =>
            version.status === "ACTIVE" &&
            version.effectiveFromMonth <= COMPENSATION_EFFECTIVE,
        ),
    ).length,
  };
}

async function main() {
  assertTestingBoundary();
  const identity = await inspectExistingIdentity();
  const existingBusiness = await inspectBusiness();

  if (!APPLY) {
    console.log(JSON.stringify({
      mode: "DRY_RUN",
      environment: process.env.RAILWAY_ENVIRONMENT_NAME,
      service: process.env.RAILWAY_SERVICE_NAME,
      databaseConnection: "APPROVED_RAILWAY_TESTING_POSTGRES",
      employeeAccountId: identity.account.id,
      royalSalonMembershipId: identity.royalMembership.id,
      targetBusinessExists: Boolean(existingBusiness),
      action: existingBusiness ? "VERIFY_OR_COMPLETE_IDEMPOTENTLY" : "CREATE_ISOLATED_FIXTURE",
      otpSent: false,
      productionTouched: false,
    }, null, 2));
    return;
  }

  const sourceUatHr = await prisma.user.findUnique({
    where: { email: SOURCE_UAT_HR_EMAIL },
    select: {
      id: true,
      loginEnabled: true,
      passwordHash: true,
      role: true,
      status: true,
    },
  });
  if (
    !sourceUatHr ||
    !sourceUatHr.passwordHash ||
    !sourceUatHr.loginEnabled ||
    sourceUatHr.status !== "active" ||
    sourceUatHr.role === "PLATFORM_ADMIN"
  ) {
    throw new Error("SAFE_TESTING_UAT_DESKTOP_CREDENTIAL_SOURCE_NOT_AVAILABLE");
  }
  const foundation = await createOrLoadFoundation(sourceUatHr.passwordHash);
  const membership = await ensureMembership({
    businessId: foundation.business.id,
    branchId: foundation.branch.id,
    owner: foundation.owner,
    employeeAccountId: identity.account.id,
  });
  await ensureCompensation({
    businessId: foundation.business.id,
    branchId: foundation.branch.id,
    membershipId: membership.id,
    owner: foundation.owner,
  });

  const verified = await verify({
    accountId: identity.account.id,
    businessId: foundation.business.id,
    branchId: foundation.branch.id,
    membershipId: membership.id,
    ownerId: foundation.owner.id,
  });
  if (verified.failures.length) {
    throw new Error(`ISOLATED_PAYROLL_UAT_PREFLIGHT_FAILED:${verified.failures.join(",")}`);
  }

  console.log(JSON.stringify({
    environment: "TESTING",
    business: verified.business.name,
    businessId: verified.business.id,
    branch: verified.branch.name,
    branchId: verified.branch.id,
    employee: verified.membership.fullName,
    phone: EMPLOYEE_PHONE,
    employeeId: verified.membership.employeeCode,
    newMembershipId: verified.membership.id,
    employment: verified.membership.status,
    joined: verified.membership.joinedAt.toISOString().slice(0, 10),
    attendance: verified.membership.attendanceEnabled ? "ENABLED" : "DISABLED",
    primaryBranch: verified.branch.name,
    compensation: `${verified.compensation?.payBasis} / MYR`,
    basic: verified.compensation?.baseRate.toFixed(2),
    effective: verified.compensation?.effectiveFromMonth.toISOString().slice(0, 10),
    augustPayrollEligible: verified.payrollEligibleMembershipCount === 1,
    staffAppLogin: "READY",
    multiBusinessSelection: "PASS",
    hrPayrollActor: `${foundation.owner.name} (${foundation.owner.email})`,
    timesheetPermission: "PASS",
    payrollPermission: "PASS",
    payslipPublishPermission: "PASS",
    payrollEligibleMembershipCount: verified.payrollEligibleMembershipCount,
    otpSent: false,
    productionTouched: false,
    finalVerdict: "READY",
    blockers: [],
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
