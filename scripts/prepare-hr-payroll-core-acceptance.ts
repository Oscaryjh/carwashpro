import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import bcrypt from "bcryptjs";
import { Prisma, PrismaClient } from "@prisma/client";
import { createEmployeeSessionRecord } from "../src/lib/attendance/employee-auth/session";
import { linkApprovedCommissionToPayroll } from "../src/lib/commission/service";
import { selectClaimReimbursementChannel } from "../src/lib/claim/reimbursement";
import { publishPayrollPayslips } from "../src/lib/payroll/payslip-publication";
import {
  finalizePayrollRun,
  generatePayrollRun,
  submitPayrollRunForReview,
} from "../src/lib/payroll/service";
import { issueTestHighRiskStepUp } from "../tests/helpers/high-risk-step-up";

const prisma = new PrismaClient();
const MONTH = "2026-08";
const PERIOD_START = new Date("2026-08-01T00:00:00.000Z");
const PERIOD_END = new Date("2026-08-31T00:00:00.000Z");
const BUSINESS_NAME = "Tetamu HR Acceptance Test";
const OWNER_EMAIL_PREFIX = "hr-core-acceptance.owner";
const MANAGER_EMAIL_PREFIX = "hr-core-acceptance.manager";

const scenarios = [
  { code: "CORE-A", name: "Core A - Normal Monthly", phone: "+60119992001", kind: "NORMAL" },
  { code: "CORE-B", name: "Core B - Approved OT", phone: "+60119992002", kind: "OT" },
  { code: "CORE-C", name: "Core C - Paid Leave", phone: "+60119992003", kind: "PAID_LEAVE" },
  { code: "CORE-D", name: "Core D - Unpaid Leave", phone: "+60119992004", kind: "UNPAID_LEAVE" },
  { code: "CORE-E", name: "Core E - Payroll Claim", phone: "+60119992005", kind: "CLAIM" },
  { code: "CORE-F", name: "Core F - Commission", phone: "+60119992006", kind: "COMMISSION" },
] as const;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function assertLocalOnly() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("HR_CORE_ACCEPTANCE_FORBIDDEN_IN_PRODUCTION");
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const hostname = new URL(databaseUrl).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error("HR_CORE_ACCEPTANCE_REQUIRES_A_LOCAL_DATABASE");
  }
  const password = process.env.HR_CORE_ACCEPTANCE_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("HR_CORE_ACCEPTANCE_PASSWORD_MUST_BE_AT_LEAST_12_CHARACTERS");
  }
  process.env.EMPLOYEE_AUTH_SECRET ??=
    "tetamu-local-hr-core-acceptance-employee-session-secret-v1";
  return password;
}

function actor(user: { id: string; name: string; email: string | null }) {
  if (!user.email) throw new Error("Acceptance actor requires an email address.");
  return { userId: user.id, name: user.name, email: user.email };
}

async function main() {
  const password = assertLocalOnly();
  const suffix = randomUUID().slice(0, 8);
  const phoneRun = Date.now().toString().slice(-7);
  const ownerEmail = `${OWNER_EMAIL_PREFIX}+${suffix}@tetamu.local`;
  const managerEmail = `${MANAGER_EMAIL_PREFIX}+${suffix}@tetamu.local`;
  const passwordHash = await bcrypt.hash(password, 10);

  const fixture = await prisma.$transaction(async (tx) => {
    const business = await tx.business.create({
      data: {
        name: BUSINESS_NAME,
        slug: `tetamu-hr-acceptance-test-${suffix}`,
        industryType: "GENERAL_SERVICE",
        timezone: "Asia/Kuching",
      },
    });
    const branch = await tx.branch.create({
      data: {
        businessId: business.id,
        name: "Acceptance Main Branch",
        countryCode: "MY",
        stateCode: "SBH",
      },
    });
    await tx.branchAttendanceSetting.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        latitude: 5.9804,
        longitude: 116.0735,
        requireGeofence: false,
        allowOutsideGeofenceRequest: true,
        timezone: "Asia/Kuching",
        isEnabled: true,
      },
    });
    const owner = await tx.user.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        name: "Core Acceptance Owner",
        email: ownerEmail,
        passwordHash,
        role: "BUSINESS_OWNER",
        status: "active",
        loginEnabled: true,
      },
    });
    const manager = await tx.user.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        name: "Core Acceptance Manager",
        email: managerEmail,
        passwordHash,
        role: "STAFF",
        permissions: ["APPROVE_LEAVE", "REVIEW_CLAIM"],
        status: "active",
        loginEnabled: true,
      },
    });
    for (const moduleKey of ["HR", "PAYROLL", "CLAIMS", "COMMISSION"] as const) {
      await tx.businessModuleEntitlement.create({
        data: {
          businessId: business.id,
          moduleKey,
          status: "ENABLED",
          enabledFrom: new Date("2026-01-01T00:00:00.000Z"),
          source: "SYSTEM",
          planCode: "LOCAL_CORE_ACCEPTANCE",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });
    }
    await tx.payrollSetting.create({
      data: {
        businessId: business.id,
        workingDaysPerMonth: 26,
        normalWorkMinutesPerDay: 480,
        breakMinutesPerDay: 60,
        overtimeMultiplier: 1.5,
        publicHolidayExtraMultiplier: 2,
        publicHolidayPayEnabled: false,
      },
    });

    const paidPolicy = await createLeavePolicy(tx, business.id, owner.id, {
      code: "ANNUAL",
      name: "Annual leave (Acceptance policy)",
      payTreatment: "PAID",
      balanceTracked: true,
      entitlement: 12,
    });
    const unpaidPolicy = await createLeavePolicy(tx, business.id, owner.id, {
      code: "UNPAID",
      name: "Unpaid leave",
      payTreatment: "UNPAID",
      balanceTracked: false,
      entitlement: null,
    });

    const members = new Map<string, {
      membershipId: string;
      accountId: string;
      deviceId: string;
    }>();
    for (const [scenarioIndex, scenario] of scenarios.entries()) {
      const phone = `+6011${phoneRun}${scenarioIndex + 1}`;
      const account = await tx.employeeAccount.create({
        data: {
          name: scenario.name,
          phoneNumber: phone,
          phoneNormalized: phone,
        },
      });
      const membership = await tx.employeeBusinessMembership.create({
        data: {
          employeeAccountId: account.id,
          businessId: business.id,
          employeeCode: scenario.code,
          fullName: scenario.name,
          phoneNumber: phone,
          phoneNumberNormalized: phone,
          employmentType: "FULL_TIME",
          status: "ACTIVE",
          attendanceEnabled: true,
          payBasis: "MONTHLY",
          baseSalary: 3000,
          workingDaysPerMonth: 26,
          normalWorkMinutesPerDay: 480,
          targetBreakMinutes: 60,
          statutoryNationality: "MALAYSIAN",
          statutoryProfileRevision: 1,
          joinedAt: new Date("2026-01-01T00:00:00.000Z"),
          position: "Acceptance tester",
        },
      });
      await tx.employeeBranchAssignment.create({
        data: {
          membershipId: membership.id,
          businessId: business.id,
          branchId: branch.id,
          isPrimary: true,
          canClockIn: true,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        },
      });
      await tx.employeeCompensationVersion.create({
        data: {
          businessId: business.id,
          membershipId: membership.id,
          effectiveFromMonth: PERIOD_START,
          payBasis: "MONTHLY",
          baseRate: 3000,
          source: "MANUAL",
          reasonType: "DATA_MIGRATION",
          reasonNote: "LOCAL / TESTING ONLY core acceptance baseline.",
          createdById: owner.id,
        },
      });
      await tx.employeeLindung24ParticipationVersion.create({
        data: {
          businessId: business.id,
          membershipId: membership.id,
          revision: 1,
          effectiveFromMonth: new Date("2026-06-01T00:00:00.000Z"),
          status: "DEFAULT_PARTICIPATING",
          employerContext: "SINGLE_EMPLOYER",
          selectedEmployer: "CURRENT_BUSINESS",
          act4Covered: false,
          sourceType: "OFFICIAL_TRANSITION",
          sourceReference: "LOCAL_CORE_ACCEPTANCE_NOT_COVERED",
          reason: "LOCAL / TESTING ONLY: controlled non-applicable LINDUNG 24 profile.",
          sourceDigest: digest(`lindung24-not-applicable-${scenario.code}`),
          recordedById: owner.id,
        },
      });
      const device = await tx.employeeDevice.create({
        data: {
          employeeAccountId: account.id,
          deviceIdentifierHash: digest(`core-acceptance-device-${scenario.code}`),
          displayName: `${scenario.code} acceptance browser`,
          platform: "Browser",
          browser: "Codex acceptance",
          canView: true,
          canPunch: true,
        },
      });
      await createEmployeeSessionRecord(
        {
          employeeAccountId: account.id,
          membershipId: membership.id,
          businessId: business.id,
          primaryBranchId: branch.id,
          attendanceBranchId: branch.id,
          deviceId: device.id,
          now: new Date(),
          userAgent: "Tetamu HR Core Acceptance",
        },
        tx,
      );
      members.set(scenario.code, {
        membershipId: membership.id,
        accountId: account.id,
        deviceId: device.id,
      });
    }

    const managerEmployee = members.get("CORE-A")!;
    await tx.user.update({
      where: { id: manager.id },
      data: {
        employeeAccountId: managerEmployee.accountId,
        employeeBusinessMembershipId: managerEmployee.membershipId,
        teamMemberLinkStatus: "LINKED",
        teamMemberLinkedAt: new Date(),
      },
    });

    const roster = await createPublishedRoster(tx, {
      businessId: business.id,
      branchId: branch.id,
      ownerId: owner.id,
      membershipIds: [...members.values()].map((member) => member.membershipId),
    });

    const paidLeave = await createApprovedLeave(tx, {
      businessId: business.id,
      branchId: branch.id,
      membershipId: members.get("CORE-C")!.membershipId,
      policy: paidPolicy,
      reviewerId: manager.id,
      day: 18,
    });
    const unpaidLeave = await createApprovedLeave(tx, {
      businessId: business.id,
      branchId: branch.id,
      membershipId: members.get("CORE-D")!.membershipId,
      policy: unpaidPolicy,
      reviewerId: manager.id,
      day: 19,
    });

    const timesheet = await createLockedTimesheet(tx, {
      businessId: business.id,
      branchId: branch.id,
      ownerId: owner.id,
      members,
      paidLeave,
      unpaidLeave,
    });

    const statement = await tx.commissionPeriod.create({
      data: {
        businessId: business.id,
        branchId: branch.id,
        scopeKey: `BRANCH:${branch.id}`,
        earnedPeriodStart: PERIOD_START,
        earnedPeriodEnd: PERIOD_END,
        status: "LOCKED",
        currentRevision: 1,
        calculatedById: owner.id,
        calculatedAt: new Date(),
        approvedById: manager.id,
        approvedAt: new Date(),
        approvalReason: "Acceptance commission reviewed.",
        sourceDigest: digest("core-f-commission-period"),
        statements: {
          create: {
            membershipId: members.get("CORE-F")!.membershipId,
            calculationRevision: 1,
            status: "APPROVED",
            eligibleSalesCents: 200000,
            calculatedCommissionCents: 20000,
            adjustmentCents: 0,
            finalCommissionCents: 20000,
            calculationDigest: digest("core-f-commission-statement"),
            approvedById: manager.id,
            approvedAt: new Date(),
          },
        },
      },
      include: { statements: true },
    });

    const claimCategory = await tx.claimCategory.create({
      data: {
        businessId: business.id,
        code: "TRAVEL",
        name: "Travel reimbursement",
        nature: "GENERAL",
        policyRevisions: {
          create: {
            revision: 1,
            status: "ACTIVE",
            effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
            nameSnapshot: "Travel reimbursement",
            natureSnapshot: "GENERAL",
            receiptRequired: false,
            descriptionRequired: true,
            statutoryTreatmentStatus: "VERIFIED_NON_WAGE",
            reason: "Acceptance non-wage business reimbursement.",
            createdById: owner.id,
          },
        },
      },
      include: { policyRevisions: true },
    });
    const claim = await tx.employeeClaim.create({
      data: {
        businessId: business.id,
        membershipId: members.get("CORE-E")!.membershipId,
        branchId: branch.id,
        claimNumber: `AC-${suffix.toUpperCase()}`,
        clientRequestId: randomUUID(),
        purpose: "Acceptance taxi reimbursement",
        currency: "MYR",
        status: "APPROVED",
        submittedTotal: 120,
        approvedTotal: 120,
        revision: 2,
        submittedAt: new Date("2026-08-21T02:00:00.000Z"),
        reviewedById: manager.id,
        reviewedAt: new Date("2026-08-22T02:00:00.000Z"),
        decisionDigest: digest("core-e-claim-decision"),
        lines: {
          create: {
            lineNumber: 1,
            categoryId: claimCategory.id,
            policyRevisionId: claimCategory.policyRevisions[0]!.id,
            categoryCodeSnapshot: "TRAVEL",
            categoryNameSnapshot: "Travel reimbursement",
            expenseNatureSnapshot: "GENERAL",
            expenseDate: new Date("2026-08-20T00:00:00.000Z"),
            description: "Acceptance taxi expense",
            submittedAmount: 120,
            approvedAmount: 120,
            receiptRequiredSnapshot: false,
            statutoryTreatmentStatus: "VERIFIED_NON_WAGE",
            reviewStatus: "APPROVED",
          },
        },
        reimbursement: {
          create: {
            amount: 120,
            currency: "MYR",
            status: "AWAITING_CHANNEL",
          },
        },
      },
      include: { reimbursement: true },
    });

    return {
      business,
      branch,
      owner,
      manager,
      members,
      roster,
      timesheet,
      commissionStatementId: statement.statements[0]!.id,
      claim,
    };
  }, { timeout: 60_000 });

  await linkApprovedCommissionToPayroll(
    {
      businessId: fixture.business.id,
      branchId: null,
      actor: actor(fixture.owner),
      capabilities: ["LINK_COMMISSION_TO_PAYROLL"],
    },
    { statementId: fixture.commissionStatementId, targetPayrollMonth: MONTH },
  );

  const run = await generatePayrollRun({
    businessId: fixture.business.id,
    actor: actor(fixture.owner),
    month: MONTH,
  });

  await selectClaimReimbursementChannel({
    businessId: fixture.business.id,
    actor: actor(fixture.manager),
    rawInput: {
      reimbursementId: fixture.claim.reimbursement!.id,
      expectedRevision: fixture.claim.reimbursement!.revision,
      operationKey: randomUUID(),
      channel: "PAYROLL",
      payrollRunId: run.id,
      note: "Acceptance non-wage reimbursement through payroll.",
    },
  });

  await submitPayrollRunForReview({
    businessId: fixture.business.id,
    actor: actor(fixture.owner),
    runId: run.id,
  });
  const stepUp = await issueTestHighRiskStepUp(prisma, {
    actionKey: "PAYROLL_FINALIZE",
    businessId: fixture.business.id,
    resourceId: run.id,
    userId: fixture.manager.id,
  });
  await finalizePayrollRun({
    businessId: fixture.business.id,
    actor: actor(fixture.manager),
    runId: run.id,
    stepUp: stepUp.stepUp,
  });
  const payslips = await publishPayrollPayslips({
    businessId: fixture.business.id,
    runId: run.id,
    actor: actor(fixture.manager),
  });

  const entries = await prisma.payrollEntry.findMany({
    where: { payrollRunId: run.id },
    orderBy: { employeeCodeSnapshot: "asc" },
    select: {
      employeeCodeSnapshot: true,
      fullNameSnapshot: true,
      basicPay: true,
      leavePay: true,
      unpaidLeaveDeduction: true,
      overtimePay: true,
      allowances: true,
      grossPay: true,
      netPay: true,
      attendanceInputSnapshot: {
        select: {
          approvedOvertimeMinutes: true,
          paidLeaveDays: true,
          unpaidLeaveDays: true,
        },
      },
      components: {
        select: { lineKey: true, amount: true, sourceType: true },
        orderBy: { sortOrder: "asc" },
      },
    },
  });
  const claimSnapshot = await prisma.payrollClaimReimbursementSnapshot.findFirstOrThrow({
    where: { payrollRunId: run.id, claimId: fixture.claim.id },
  });
  const finalizedRun = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run.id } });
  const artifact = {
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: fixture.business.id,
    businessSlug: fixture.business.slug,
    businessName: fixture.business.name,
    timezone: fixture.business.timezone,
    month: MONTH,
    ownerEmail,
    managerEmail,
    branchId: fixture.branch.id,
    roster: fixture.roster,
    timesheet: fixture.timesheet,
    payrollRunId: run.id,
    payrollRunStatus: finalizedRun.status,
    payslips,
    claimSnapshot: {
      id: claimSnapshot.id,
      status: claimSnapshot.status,
      amount: claimSnapshot.amount.toString(),
      statutoryTreatmentStatus: claimSnapshot.statutoryTreatmentStatus,
    },
    employeeMemberships: Object.fromEntries(
      [...fixture.members.entries()].map(([code, member]) => [
        code,
        { membershipId: member.membershipId },
      ]),
    ),
    entries: entries.map((entry) => ({
      ...entry,
      basicPay: entry.basicPay.toString(),
      leavePay: entry.leavePay.toString(),
      unpaidLeaveDeduction: entry.unpaidLeaveDeduction.toString(),
      overtimePay: entry.overtimePay.toString(),
      allowances: entry.allowances.toString(),
      grossPay: entry.grossPay.toString(),
      netPay: entry.netPay.toString(),
      attendanceInputSnapshot: entry.attendanceInputSnapshot && {
        approvedOvertimeMinutes: entry.attendanceInputSnapshot.approvedOvertimeMinutes,
        paidLeaveDays: entry.attendanceInputSnapshot.paidLeaveDays.toString(),
        unpaidLeaveDays: entry.attendanceInputSnapshot.unpaidLeaveDays.toString(),
      },
      components: entry.components.map((component) => ({
        ...component,
        amount: component.amount.toString(),
      })),
    })),
    cleanup: {
      strategy: "Archive or delete this single local business by businessId after acceptance evidence is retained.",
      businessId: fixture.business.id,
      guard: "LOCAL database only. Verify the business name before any archive or delete operation.",
    },
  };

  const outputDirectory = join(process.cwd(), ".tmp");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "hr-payroll-core-acceptance.json");
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    environment: artifact.environment,
    businessId: artifact.businessId,
    businessSlug: artifact.businessSlug,
    month: artifact.month,
    payrollRunId: artifact.payrollRunId,
    payrollRunStatus: artifact.payrollRunStatus,
    payslipCount: payslips.employeeCount,
    outputPath,
  }, null, 2));
}

async function createLeavePolicy(
  tx: Prisma.TransactionClient,
  businessId: string,
  ownerId: string,
  input: {
    code: string;
    name: string;
    payTreatment: "PAID" | "UNPAID";
    balanceTracked: boolean;
    entitlement: number | null;
  },
) {
  const policy = await tx.leavePolicy.create({
    data: {
      businessId,
      code: input.code,
      name: input.name,
      payTreatment: input.payTreatment,
      countMode: "WEEKDAYS",
      balanceTracked: input.balanceTracked,
      defaultEntitlementDays: input.entitlement,
      origin: "BUSINESS_CUSTOM",
      legalStatus: "COMPANY_POLICY_ONLY",
    },
  });
  const version = await tx.leavePolicyVersion.create({
    data: {
      businessId,
      policyId: policy.id,
      revision: 1,
      effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
      nameSnapshot: input.name,
      payTreatment: input.payTreatment,
      countMode: "WEEKDAYS",
      balanceTracked: input.balanceTracked,
      defaultEntitlementDays: input.entitlement,
      origin: "BUSINESS_CUSTOM",
      legalStatus: "COMPANY_POLICY_ONLY",
      sourceReference: "LOCAL_CORE_ACCEPTANCE",
      reason: "LOCAL / TESTING ONLY acceptance policy; not a statutory rule.",
      createdById: ownerId,
    },
  });
  return { ...policy, version };
}

async function createPublishedRoster(
  tx: Prisma.TransactionClient,
  input: { businessId: string; branchId: string; ownerId: string; membershipIds: string[] },
) {
  const template = await tx.rosterShiftTemplate.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId,
      name: "Acceptance Day Shift",
      shortCode: "DAY",
      startMinute: 540,
      endMinute: 1080,
      breakMinutes: 60,
      breakPaid: false,
      colorToken: "TEAL",
      createdById: input.ownerId,
      updatedById: input.ownerId,
    },
  });
  const period = await tx.rosterPeriod.create({
    data: {
      businessId: input.businessId,
      branchId: input.branchId,
      weekStart: new Date("2026-08-03T00:00:00.000Z"),
      status: "PUBLISHED",
      draftRevision: 1,
      publicationRevision: 1,
      createdById: input.ownerId,
      updatedById: input.ownerId,
    },
  });
  const publication = await tx.rosterPublication.create({
    data: {
      rosterPeriodId: period.id,
      businessId: input.businessId,
      branchId: input.branchId,
      revision: 1,
      operationKey: `core-acceptance-roster-${period.id}`,
      sourceDigest: digest("acceptance-published-roster"),
      reason: "LOCAL / TESTING ONLY core acceptance roster.",
      publishedById: input.ownerId,
    },
  });
  for (const [index, membershipId] of input.membershipIds.entries()) {
    const day = index + 3;
    const workDate = new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    const startAt = new Date(`2026-08-${String(day).padStart(2, "0")}T01:00:00.000Z`);
    const endAt = new Date(`2026-08-${String(day).padStart(2, "0")}T10:00:00.000Z`);
    const assignment = await tx.rosterAssignment.create({
      data: {
        businessId: input.businessId,
        branchId: input.branchId,
        rosterPeriodId: period.id,
        membershipId,
        workDate,
        kind: "WORK_SHIFT",
        shiftTemplateId: template.id,
        shiftNameSnapshot: template.name,
        shiftColorSnapshot: template.colorToken,
        crossMidnightSnapshot: false,
        startAt,
        endAt,
        breakMinutes: 60,
        breakPaidSnapshot: false,
        createdById: input.ownerId,
        updatedById: input.ownerId,
      },
    });
    await tx.rosterPublishedAssignment.create({
      data: {
        publicationId: publication.id,
        sourceAssignmentId: assignment.id,
        resolvedSource: "CUSTOM_SHIFT",
        businessId: input.businessId,
        branchId: input.branchId,
        membershipId,
        workDate,
        kind: "WORK_SHIFT",
        shiftTemplateId: template.id,
        shiftNameSnapshot: template.name,
        shiftColorSnapshot: template.colorToken,
        crossMidnightSnapshot: false,
        startAt,
        endAt,
        breakMinutes: 60,
        breakPaidSnapshot: false,
        timezoneSnapshot: "Asia/Kuching",
        evidenceDisposition: "APPLIED",
        evidenceReference: "LOCAL_CORE_ACCEPTANCE",
      },
    });
  }
  return { periodId: period.id, status: period.status, publishedRevision: period.publicationRevision };
}

async function createApprovedLeave(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    membershipId: string;
    reviewerId: string;
    day: number;
    policy: Awaited<ReturnType<typeof createLeavePolicy>>;
  },
) {
  const leaveDate = new Date(`2026-08-${String(input.day).padStart(2, "0")}T00:00:00.000Z`);
  const request = await tx.leaveRequest.create({
    data: {
      businessId: input.businessId,
      membershipId: input.membershipId,
      branchId: input.branchId,
      policyId: input.policy.id,
      policyVersionId: input.policy.version.id,
      policyNameSnapshot: input.policy.name,
      payTreatmentSnapshot: input.policy.payTreatment,
      balanceTrackedSnapshot: input.policy.balanceTracked,
      legalStatusSnapshot: "COMPANY_POLICY_ONLY",
      complianceStatusSnapshot: "NOT_APPLICABLE",
      leaveUnit: "FULL_DAY",
      startsOn: leaveDate,
      endsOn: leaveDate,
      requestedDays: 1,
      reason: "Core acceptance leave scenario.",
      status: "APPROVED",
      revision: 1,
      clientRequestId: randomUUID(),
      reviewedById: input.reviewerId,
      reviewedAt: new Date(),
      decisionDigest: digest(`leave-${input.membershipId}-${input.day}`),
      days: {
        create: {
          businessId: input.businessId,
          membershipId: input.membershipId,
          leaveDate,
          dayFraction: 1,
          leaveUnit: "FULL_DAY",
          expectedDayKindSnapshot: "WORKDAY",
          policyVersionId: input.policy.version.id,
          payTreatmentSnapshot: input.policy.payTreatment,
          balanceConsumptionUnits: 1,
        },
      },
    },
  });
  return { request, policy: input.policy, leaveDate };
}

async function createLockedTimesheet(
  tx: Prisma.TransactionClient,
  input: {
    businessId: string;
    branchId: string;
    ownerId: string;
    members: Map<string, { membershipId: string }>;
    paidLeave: Awaited<ReturnType<typeof createApprovedLeave>>;
    unpaidLeave: Awaited<ReturnType<typeof createApprovedLeave>>;
  },
) {
  const timesheet = await tx.attendanceMonthlyTimesheet.create({
    data: { businessId: input.businessId, periodStart: PERIOD_START },
  });
  const revision = await tx.attendanceTimesheetRevision.create({
    data: {
      businessId: input.businessId,
      timesheetId: timesheet.id,
      revision: 1,
      periodStart: PERIOD_START,
      sourceDigest: digest("core-acceptance-timesheet-revision"),
      reason: "Core acceptance approved monthly Timesheet.",
      lockedById: input.ownerId,
    },
  });
  await tx.attendanceMonthlyTimesheet.update({
    where: { id: timesheet.id },
    data: { currentRevisionId: revision.id, status: "LOCKED" },
  });
  for (const [index, scenario] of scenarios.entries()) {
    const membershipId = input.members.get(scenario.code)!.membershipId;
    const day = index + 3;
    const workDate = new Date(`2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`);
    const leave = scenario.kind === "PAID_LEAVE"
      ? input.paidLeave
      : scenario.kind === "UNPAID_LEAVE"
        ? input.unpaidLeave
        : null;
    const outcome = leave
      ? leave.policy.payTreatment === "PAID" ? "APPROVED_PAID_LEAVE" : "APPROVED_UNPAID_LEAVE"
      : "PRESENT";
    const workedMinutes = leave ? 0 : scenario.kind === "OT" ? 660 : 480;
    const approvedOtMinutes = scenario.kind === "OT" ? 180 : 0;
    const sourceDigest = digest(`${scenario.code}-${outcome}-${workedMinutes}`);
    const result = await tx.attendanceP2FinalResult.create({
      data: {
        businessId: input.businessId,
        branchId: input.branchId,
        membershipId,
        workDate: leave?.leaveDate ?? workDate,
        version: 1,
        outcome,
        expectedDayKindSnapshot: "WORKDAY",
        leaveDayFractionSnapshot: leave ? 1 : undefined,
        totalBreakMinutes: leave ? 0 : 60,
        totalWorkedMinutes: workedMinutes,
        sourceDigest,
        resolutionDigest: digest(`resolved-${sourceDigest}`),
        createdById: input.ownerId,
      },
    });
    const daySnapshot = await tx.attendanceTimesheetP2DaySnapshot.create({
      data: {
        revisionId: revision.id,
        businessId: input.businessId,
        branchId: input.branchId,
        membershipId,
        workDate: leave?.leaveDate ?? workDate,
        finalResultId: result.id,
        finalResultVersion: result.version,
        outcome,
        expectedDayKindSnapshot: "WORKDAY",
        leaveDayFractionSnapshot: leave ? 1 : undefined,
        leaveRequestIdSnapshot: leave?.request.id,
        leaveRequestRevisionSnapshot: leave?.request.revision,
        leaveRequestDigestSnapshot: leave?.request.decisionDigest,
        leavePolicyIdSnapshot: leave?.policy.id,
        leavePolicyVersionIdSnapshot: leave?.policy.version.id,
        leavePolicyNameSnapshot: leave?.policy.name,
        leavePayTreatmentSnapshot: leave?.policy.payTreatment,
        leaveUnitSnapshot: leave ? "FULL_DAY" : undefined,
        leaveLegalStatusSnapshot: leave ? "COMPANY_POLICY_ONLY" : undefined,
        leaveComplianceStatusSnapshot: leave ? "NOT_APPLICABLE" : undefined,
        timezoneSnapshot: "Asia/Kuching",
        potentialOtMinutes: approvedOtMinutes,
        approvedOtMinutes,
        otContext: approvedOtMinutes ? "NORMAL" : undefined,
        otApprovalStatus: approvedOtMinutes ? "APPROVED" : "NOT_APPLICABLE",
        otApprovalRef: approvedOtMinutes ? randomUUID() : undefined,
        otApprovalRevision: approvedOtMinutes ? 1 : undefined,
        totalBreakMinutes: leave ? 0 : 60,
        totalWorkedMinutes: workedMinutes,
        sourceDigest,
      },
    });
    if (!leave) {
      const segmentStart = new Date(`2026-08-${String(day).padStart(2, "0")}T01:00:00.000Z`);
      const segmentEnd = new Date(
        segmentStart.getTime() + (workedMinutes + 60) * 60_000,
      );
      await tx.attendanceTimesheetP2SegmentSnapshot.create({
        data: {
          revisionId: revision.id,
          businessId: input.businessId,
          branchId: input.branchId,
          membershipId,
          sourceDaySnapshotId: daySnapshot.id,
          sourceFinalResultId: result.id,
          segmentIndex: 0,
          localDate: workDate,
          startAt: segmentStart,
          endAt: segmentEnd,
          timezoneSnapshot: "Asia/Kuching",
          context: "NORMAL",
          expectedDayKindSnapshot: "WORKDAY",
          isRestDay: false,
          isPublicHoliday: false,
          isUnscheduled: false,
          grossMinutes: workedMinutes + 60,
          breakMinutes: 60,
          workedMinutes,
          potentialOtMinutes: approvedOtMinutes,
          approvedOtMinutes,
          sourceDigest: digest(`${sourceDigest}-segment-0`),
        },
      });
    }
  }
  return { timesheetId: timesheet.id, revisionId: revision.id, status: "LOCKED" as const };
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
