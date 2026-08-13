import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { encryptMfaSecret } from "../src/lib/auth/mfa-crypto";
import { generateTotpSecret } from "../src/lib/auth/mfa-totp";
import { writeEmployeeCompensationVersionInTransaction } from "../src/lib/payroll/compensation-version";
import { updateEmployeeStatutoryProfileInTransaction } from "../src/lib/payroll/employee-profile-write/statutory";
import { generatePayrollRun, submitPayrollRunForReview } from "../src/lib/payroll/service";

const QA_BUSINESS_SLUG = "qa-commission-browser-salon";
const QA_APPROVER_EMAIL = "commission-browser-approver@test.local";
const QA_MONTH = "2026-09";
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/car_wash_crm_pos?schema=public";

process.env.DATABASE_URL ??= LOCAL_DATABASE_URL;
const prisma = new PrismaClient();

async function main() {
  assertLocalDatabase();
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: QA_BUSINESS_SLUG },
  });
  const branch = await prisma.branch.findFirstOrThrow({
    where: { businessId: business.id, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
  const approver = await prisma.user.findUniqueOrThrow({
    where: { email: QA_APPROVER_EMAIL },
  });
  if (
    approver.businessId !== business.id ||
    approver.role !== "BUSINESS_OWNER" ||
    !approver.loginEnabled ||
    approver.status !== "active"
  ) {
    throw new Error("PAYROLL_MFA_QA_APPROVER_IS_NOT_AN_ACTIVE_LOCAL_BUSINESS_OWNER");
  }

  const membership = await prisma.employeeBusinessMembership.findFirstOrThrow({
    where: { businessId: business.id, employeeCode: "COMMISSION-BROWSER-A", status: "ACTIVE" },
  });
  const approvedCommission = await prisma.payrollVariablePay.findFirstOrThrow({
    where: {
      businessId: business.id,
      membershipId: membership.id,
      type: "COMMISSION",
      origin: "SYSTEM",
      payrollPeriodStart: new Date(`${QA_MONTH}-01T00:00:00.000Z`),
      status: { in: ["APPROVED", "APPLIED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (!approvedCommission.amount.equals("8.00")) {
    throw new Error("EXPECTED_APPROVED_RM8_COMMISSION_FIXTURE_NOT_FOUND");
  }

  const periodStart = new Date(`${QA_MONTH}-01T00:00:00.000Z`);
  const actor = { userId: approver.id, name: approver.name, email: approver.email! };
  const access = {
    actorRole: "BUSINESS_OWNER" as const,
    branchId: branch.id,
    businessId: business.id,
    capability: null,
    effectiveBusinessRole: "BUSINESS_OWNER" as const,
    granted: true as const,
    groupId: null,
    groupUserId: null,
    homeBusinessId: business.id,
    identityRole: "BUSINESS_OWNER" as const,
    industryType: business.industryType,
    permissions: [] as string[],
    source: "DIRECT_BUSINESS" as const,
    userId: approver.id,
  };

  await prisma.$transaction(async (transaction) => {
    if (!membership.statutoryNationality) {
      await updateEmployeeStatutoryProfileInTransaction({
        context: {
          access,
          actor,
          allowedBranchIds: [branch.id],
          businessId: business.id,
          caller: "SYSTEM",
        },
        command: {
          commandId: randomUUID(),
          membershipId: membership.id,
          expectedRevision: membership.statutoryProfileRevision,
          statutoryNationality: "MALAYSIAN",
          epfEnabled: membership.epfEnabled,
          epfMemberBeforeAug1998: membership.epfMemberBeforeAug1998,
          socsoEnabled: membership.socsoEnabled,
          socsoCategory: membership.socsoCategory,
          eisEnabled: membership.eisEnabled,
          eisPreviouslyContributed: membership.eisPreviouslyContributed,
          lindung24OptIn: membership.lindung24OptIn,
          reasonType: "OTHER",
          reasonNote: "LOCAL / TESTING ONLY Payroll high-risk MFA browser fixture.",
        },
      }, transaction);
    }
    const lindung24Version = await transaction.employeeLindung24ParticipationVersion.findFirst({
      where: { businessId: business.id, membershipId: membership.id },
      orderBy: { revision: "desc" },
    });
    if (!lindung24Version) {
      await transaction.employeeLindung24ParticipationVersion.create({
        data: {
          act4Covered: false,
          businessId: business.id,
          effectiveFromMonth: new Date("2026-01-01T00:00:00.000Z"),
          employerContext: "SINGLE_EMPLOYER",
          membershipId: membership.id,
          reason: "LOCAL / TESTING ONLY employee is outside Act 4 coverage.",
          recordedById: approver.id,
          revision: 1,
          selectedEmployer: "CURRENT_BUSINESS",
          sourceDigest: "8".repeat(64),
          sourceReference: "LOCAL_PAYROLL_MFA_BROWSER_NOT_ACT4_COVERED",
          sourceType: "OFFICIAL_TRANSITION",
          status: "DEFAULT_PARTICIPATING",
        },
      });
    }
    await writeEmployeeCompensationVersionInTransaction({
      actor,
      authorization: { access, allowedBranchIds: [branch.id] },
      baseRate: "3000.00",
      businessId: business.id,
      effectiveFromMonth: periodStart,
      membershipId: membership.id,
      payBasis: "MONTHLY",
      reasonNote: "LOCAL / TESTING ONLY Payroll high-risk MFA browser fixture.",
      reasonType: "OTHER",
      source: "MANUAL",
    }, transaction);

    const timesheet = await transaction.attendanceMonthlyTimesheet.upsert({
      where: { businessId_periodStart: { businessId: business.id, periodStart } },
      create: { businessId: business.id, periodStart },
      update: {},
    });
    if (timesheet.status !== "LOCKED" || !timesheet.currentRevisionId) {
      const latestRevision = await transaction.attendanceTimesheetRevision.findFirst({
        where: { timesheetId: timesheet.id },
        orderBy: { revision: "desc" },
      });
      const revision = latestRevision ?? await transaction.attendanceTimesheetRevision.create({
        data: {
          businessId: business.id,
          lockedById: approver.id,
          periodStart,
          reason: "LOCAL / TESTING ONLY Payroll high-risk MFA browser fixture.",
          revision: 1,
          sourceDigest: "9".repeat(64),
          timesheetId: timesheet.id,
        },
      });
      await transaction.attendanceMonthlyTimesheet.update({
        where: { id: timesheet.id },
        data: { currentRevisionId: revision.id, status: "LOCKED" },
      });
    }
  });

  let run = await prisma.payrollRun.findUnique({
    where: {
      businessId_periodStart_periodEnd: {
        businessId: business.id,
        periodStart,
        periodEnd: new Date("2026-10-01T00:00:00.000Z"),
      },
    },
  });
  if (run?.status === "FINALIZED") {
    throw new Error("QA_PAYROLL_RUN_IS_ALREADY_FINALIZED");
  }
  if (!run || run.status === "DRAFT") {
    run = await generatePayrollRun({ actor, businessId: business.id, month: QA_MONTH });
  }
  if (run.status === "DRAFT") {
    run = await submitPayrollRunForReview({ actor, businessId: business.id, runId: run.id });
  }
  if (run.status !== "REVIEW") throw new Error("QA_PAYROLL_RUN_IS_NOT_READY_FOR_FINALIZE");

  const entry = await prisma.payrollEntry.findFirstOrThrow({
    where: { payrollRunId: run.id, membershipId: membership.id },
    include: { components: true },
  });
  const commissionComponent = entry.components.find(
    (component) => component.sourceId === approvedCommission.id,
  );
  if (!commissionComponent || !commissionComponent.amount.equals("8.00")) {
    throw new Error("APPROVED_COMMISSION_DID_NOT_FLOW_TO_PAYROLL_UNCHANGED");
  }

  await prisma.sensitiveActionAuthorization.deleteMany({ where: { userId: approver.id } });
  await prisma.authSecurityEvent.deleteMany({ where: { userId: approver.id } });
  await prisma.authSession.deleteMany({ where: { userId: approver.id } });
  await prisma.userMfaCredential.deleteMany({ where: { userId: approver.id } });

  const credentialId = randomUUID();
  const secret = generateTotpSecret();
  const encrypted = encryptMfaSecret(secret, {
    credentialId,
    userId: approver.id,
    type: "TOTP",
  });
  const now = new Date();
  await prisma.userMfaCredential.create({
    data: {
      id: credentialId,
      userId: approver.id,
      type: "TOTP",
      status: "ACTIVE",
      ...encrypted,
      enrolledAt: now,
      verifiedAt: now,
      pendingExpiresAt: null,
      enrollmentSessionId: null,
      lastAcceptedCounter: null,
    },
  });

  console.log(JSON.stringify({
    environment: "LOCAL / TESTING ONLY",
    productionAccessed: false,
    businessId: business.id,
    businessSlug: business.slug,
    approverEmail: approver.email,
    payrollRunId: run.id,
    payrollRunStatus: run.status,
    commissionAmount: commissionComponent.amount.toFixed(2),
    mfaStatus: "ENROLLED_QA_ONLY",
    bankAccountUrl: `/team/employees/${membership.id}/payroll`,
    payrollRunUrl: `/team/payroll/runs/${run.id}`,
  }, null, 2));
}

function assertLocalDatabase() {
  const hostname = new URL(process.env.DATABASE_URL!).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname)) {
    throw new Error("LOCAL_TESTING_ONLY");
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
